<?php

namespace App\Http\Controllers\Payment;

use App\Enums\PaymentStatus;
use App\Http\Controllers\Controller;
use App\Models\Payment;
use App\Models\WebhookEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class XenditWebhookController extends Controller
{
    public function handle(Request $request): JsonResponse
    {
        $payload = $request->all();
        $callbackToken = $request->header('x-callback-token');
        $expectedToken = config('services.xendit.webhook_token');

        if (!$callbackToken || !$expectedToken) {
            Log::warning('Xendit webhook: missing callback token or config');
            return response()->json(['error' => 'Token verification required'], 400);
        }

        if (!hash_equals($expectedToken, $callbackToken)) {
            Log::warning('Xendit webhook: token verification failed');
            return response()->json(['error' => 'Invalid token'], 400);
        }

        $event = $payload['event'] ?? null;
        $data = $payload['data'] ?? [];
        $isFlatInvoice = !$event && isset($payload['external_id'], $payload['status']);

        if (!$event && !$isFlatInvoice) {
            return response()->json(['error' => 'Invalid payload'], 400);
        }

        // ── Replay guard ──────────────────────────────────────────────────
        // Persist every event keyed by a stable id so a redelivery is a true
        // no-op. Only a fully-'processed' event short-circuits; an event that
        // was created but crashed mid-processing stays 'received' and is safely
        // re-run (the business handlers are independently idempotent via row
        // locks + terminal-state checks, so this is a fast-path, not the sole
        // safety net).
        $eventId = $this->deriveEventId($request, $payload, $event, $data);
        $eventRow = null;
        if ($eventId) {
            $eventRow = WebhookEvent::firstOrCreate(
                ['provider' => 'xendit', 'event_id' => $eventId],
                ['event_type' => $event, 'payload' => $payload, 'status' => 'received'],
            );
            if ($eventRow->status === 'processed') {
                return response()->json(['status' => 'ok', 'deduped' => true]);
            }
        }

        // ── Dispatch ─────────────────────────────────────────────────────
        if ($event) {
            match ($event) {
                'payment.succeeded' => $this->handlePaymentSucceeded($data),
                'payment.failed' => $this->handlePaymentFailed($data),
                'payment.pending' => $this->handlePaymentPending($data),
                'refund.succeeded' => $this->handleRefundSucceeded($data),
                // Legacy: v2 invoices (card payments, card tips and wallet
                // top-ups started before those were retired) may fire these.
                'invoice.paid' => $this->handleInvoicePaid($data ?: $payload),
                'invoice.expired' => $this->handleInvoiceExpired($data ?: $payload),
                // Payouts (Xendit Payouts v2). Success marks the payout
                // completed; failure/reversal re-credits the wallet.
                'payout.succeeded' => $this->handlePayoutSucceeded($data),
                'payout.failed', 'payout.reversed' => $this->handlePayoutFailed($data),
                default => null,
            };
        } else {
            // Legacy: classic Xendit INVOICE webhook for a card payment / card
            // tip / top-up started before those were retired — the invoice
            // object is POSTed FLAT at the top level — { id, external_id,
            // status: "PAID", ... }.
            $status = strtoupper((string) $payload['status']);
            if (in_array($status, ['PAID', 'SETTLED'], true)) {
                $this->handleInvoicePaid($payload);
            } elseif ($status === 'EXPIRED') {
                $this->handleInvoiceExpired($payload);
            }
            // Other statuses acknowledged without action so Xendit stops retrying.
        }

        if ($eventRow) {
            $eventRow->update(['status' => 'processed', 'processed_at' => now()]);
        }

        return response()->json(['status' => 'ok']);
    }

    private function handlePayoutSucceeded(array $data): void
    {
        $tx = $this->findPayoutTransaction($data);
        if (! $tx) {
            return;
        }

        // Xendit paid a payout we had already marked failed — and failing it
        // put the money back in the wallet. The user has been paid twice. That
        // can't be undone automatically (they may already have spent or
        // withdrawn the re-credit), so it must reach a person, loudly.
        if ($tx->status === 'failed') {
            $this->alertPaidAfterFailed($tx, $data);

            return;
        }

        if ($tx->status !== 'pending') {
            return;
        }

        // A send whose answer never came back has no Xendit id yet.
        if (blank($tx->gateway_ref) && filled($data['id'] ?? null)) {
            \App\Models\WalletTransaction::whereKey($tx->id)->whereNull('gateway_ref')->update(['gateway_ref' => $data['id']]);
        }

        try {
            app(\App\Services\WalletService::class)->completePayout($tx->id);
        } catch (\App\Exceptions\PayoutStateException) {
            // Already settled by a racing delivery — no-op.
        }
    }

    /** Raise (once per payout) the staff alert for a payout paid after it was failed. */
    private function alertPaidAfterFailed(\App\Models\WalletTransaction $tx, array $data): void
    {
        if (! \Illuminate\Support\Facades\Cache::add("payout_paid_after_failed:{$tx->id}", true, now()->addDays(7))) {
            return;
        }

        $amount = number_format(abs((float) $tx->amount), 2);

        Log::critical('Xendit paid a payout already marked failed and re-credited — paid twice', [
            'wallet_tx' => $tx->id,
            'user_id' => $tx->user_id,
            'amount' => (float) $tx->amount,
            'gateway_payout' => $data['id'] ?? null,
            'failure_reason' => $tx->failure_reason,
        ]);

        \App\Models\AdminAlert::raise(
            'payout_paid_after_failed',
            'critical',
            'Payout paid after it was marked failed',
            "Xendit just confirmed a ₱{$amount} payout that had already been marked failed, and failing it put ₱{$amount} "
                ."back in the user’s wallet — they have been paid twice. Recover ₱{$amount} (debit the wallet if it is "
                .'still there, otherwise contact the user).',
            $tx->id,
        );
    }

    private function handlePayoutFailed(array $data): void
    {
        $tx = $this->findPayoutTransaction($data);
        if (! $tx) {
            return;
        }

        $reason = $data['failure_code'] ?? $data['status'] ?? 'Payout failed at gateway';

        try {
            $wallet = app(\App\Services\WalletService::class);
            // Route by the payout's current state, not the event label — some
            // gateways send `payout.reversed` for both a pre-disbursement failure
            // and a post-success bounce:
            //   - pending   → failPayout re-credits and marks it failed (this IS
            //     Xendit saying it failed, so a sent payout may be failed).
            //   - completed → reversePayout re-credits and marks it reversed
            //     (this is the money-loss MONEYX-1 was: a reversal after success
            //     used to hit failPayout's pending-only guard and be dropped).
            $updated = null;
            if ($tx->status === 'pending') {
                $updated = $wallet->failPayout($tx->id, (string) $reason, confirmedByGateway: true);
            } elseif ($tx->status === 'completed') {
                $updated = $wallet->reversePayout($tx->id, (string) $reason);
            }
            // else: already failed/reversed → no-op.

            // Tell the user their money bounced back. failPayout/reversePayout
            // each commit their own transaction and return the settled row, so
            // this runs post-commit (never inside the lock). The helper is
            // latched per payout, so a racing admin action or a duplicate
            // gateway delivery can't send a second notice.
            if ($updated) {
                $wallet->notifyPayoutBounced($updated, (string) $reason);
            }
        } catch (\App\Exceptions\PayoutStateException) {
            // Raced to a terminal state by another delivery — no-op.
        }
    }

    /**
     * Resolve the payout WalletTransaction from a Xendit payout webhook: match
     * on the stored gateway payout id first, then fall back to the
     * `payout-{tx}` reference_id set when the payout was created.
     */
    private function findPayoutTransaction(array $data): ?\App\Models\WalletTransaction
    {
        $query = \App\Models\WalletTransaction::where('type', 'payout');

        if (! blank($data['id'] ?? null)) {
            $tx = (clone $query)->where('gateway_ref', $data['id'])->first();
            if ($tx) {
                return $tx;
            }
        }

        $ref = $data['reference_id'] ?? null;
        if (is_string($ref) && str_starts_with($ref, 'payout-')) {
            return (clone $query)->whereKey(substr($ref, 7))->first();
        }

        return null;
    }

    /**
     * A stable, replay-safe identifier for the event. Prefers Xendit's own
     * `webhook-id` header, then a top-level id (flat invoice callbacks), then a
     * synthesized `{event}:{resource-ref}` — the event type is included so
     * `payment.succeeded` and `payment.failed` for the same charge never
     * collide.
     */
    private function deriveEventId(Request $request, array $payload, ?string $event, array $data): ?string
    {
        $headerId = $request->header('webhook-id');
        if (!blank($headerId)) {
            return 'xnd:' . $headerId;
        }

        if ($event) {
            $ref = $data['id']
                ?? $data['payment_request_id']
                ?? $data['reference_id']
                ?? $data['external_id']
                ?? md5(json_encode($data));
            return $event . ':' . $ref;
        }

        // Flat invoice callback.
        $ref = $payload['id'] ?? $payload['external_id'] ?? null;
        if ($ref) {
            return 'inv:' . $ref . ':' . strtoupper((string) ($payload['status'] ?? ''));
        }

        return null;
    }

    /**
     * Legacy: invoice paid — a card payment ("booking-{paymentId}"), card tip
     * ("tip-{txId}") or wallet top-up ("topup-{txId}") started before cards and
     * top-ups were retired. Kept so money already in flight at the deploy still
     * settles; delete once no pending invoice rows remain.
     */
    private function handleInvoicePaid(array $data): void
    {
        $externalId = $data['external_id'] ?? null;
        if (!$externalId) {
            return;
        }

        if (str_starts_with($externalId, 'topup-')) {
            $transactionId = substr($externalId, 6);
            app(\App\Services\WalletService::class)->completeTopUp($transactionId, $data);
            return;
        }

        // Gateway-funded tip ("tip-{txId}"): credits the runner + stamps
        // booking.tip_amount, idempotently. Separate from the booking charge so
        // a tip never touches payment_status.
        if (str_starts_with($externalId, 'tip-')) {
            $transactionId = substr($externalId, 4);
            app(\App\Services\WalletService::class)->completeGatewayTip($transactionId, $data);
            return;
        }

        if (str_starts_with($externalId, 'booking-')) {
            $paymentId = substr($externalId, 8);
            $payment = DB::transaction(function () use ($paymentId, $data) {
                $payment = Payment::where('id', $paymentId)->lockForUpdate()->first();
                if (!$payment || !$this->canAdvance($payment, PaymentStatus::Completed)) {
                    return null;
                }
                // Under-settled → leave pending (do NOT mark paid or notify).
                if (!$this->settledInFull($payment, $data)) {
                    return null;
                }
                $payment->transitionTo(PaymentStatus::Completed, 'webhook', 'invoice.paid', extra: [
                    'paid_at' => now(),
                    'gateway_response' => $data,
                ]);
                if ($payment->booking) {
                    $payment->booking->update(['payment_status' => 'paid']);
                }
                return $payment;
            });

            if ($payment) {
                $this->notifyPayment($payment, 'completed');
            }
            // Self-healing settlement (MONEY-1/3): resolve the booking seam for
            // the Completed charge whether THIS delivery transitioned it or a
            // prior one did. Driving it off the terminal state (not just this
            // delivery) means a settlement a transient DB error dropped is
            // retried on Xendit's redelivery. A throw here leaves the
            // WebhookEvent un-'processed' (see handle()), so the redelivery
            // re-runs it. settlePaidBooking is idempotent.
            $settleTarget = $payment
                ?? Payment::where('id', substr($externalId, 8))->where('status', PaymentStatus::Completed->value)->first();
            if ($settleTarget) {
                app(\App\Services\BookingSettlementService::class)->settlePaidBooking($settleTarget);
            }
        }
    }

    /**
     * Legacy: invoice expired before it was paid (see handleInvoicePaid) —
     * moves the pending charge/top-up to a truthful terminal state so the app
     * stops "verifying" forever.
     */
    private function handleInvoiceExpired(array $data): void
    {
        $externalId = $data['external_id'] ?? null;
        if (!$externalId) {
            return;
        }

        if (str_starts_with($externalId, 'topup-')) {
            $transactionId = substr($externalId, 6);
            app(\App\Services\WalletService::class)->expireTopUp($transactionId, 'Invoice expired');
            return;
        }

        if (str_starts_with($externalId, 'tip-')) {
            $transactionId = substr($externalId, 4);
            app(\App\Services\WalletService::class)->expireGatewayTip($transactionId, 'Invoice expired');
            return;
        }

        if (str_starts_with($externalId, 'booking-')) {
            $paymentId = substr($externalId, 8);
            $payment = DB::transaction(function () use ($paymentId, $data) {
                $payment = Payment::where('id', $paymentId)->lockForUpdate()->first();
                if (!$payment || !$this->canAdvance($payment, PaymentStatus::Expired)) {
                    return null;
                }
                $payment->transitionTo(PaymentStatus::Expired, 'webhook', 'invoice.expired', extra: [
                    'gateway_response' => $data,
                ]);
                // Never downgrade a booking whose money actually arrived (a later
                // attempt may already have settled it) — see PaymentService.
                if ($payment->booking && ! in_array($payment->booking->payment_status, ['paid', 'refunded'], true)) {
                    $payment->booking->update(['payment_status' => 'expired']);
                }
                return $payment;
            });

            if ($payment) {
                // Cancel first, so the notice can say whether the errand ended.
                app(\App\Services\BookingSettlementService::class)->cancelUnpaidBooking($payment);
                $this->notifyPayment($payment, 'expired');
            }
        }
    }

    private function handlePaymentSucceeded(array $data): void
    {
        $paymentRequestId = $data['payment_request_id'] ?? null;
        if (!$paymentRequestId) {
            return;
        }

        $payment = DB::transaction(function () use ($paymentRequestId, $data) {
            $payment = Payment::where('gateway_tx_id', $paymentRequestId)
                ->lockForUpdate()
                ->first();

            if (!$payment || !$this->canAdvance($payment, PaymentStatus::Completed)) {
                return null;
            }

            // Under-settled → leave pending (do NOT mark paid or notify).
            if (!$this->settledInFull($payment, $data)) {
                return null;
            }
            $payment->transitionTo(PaymentStatus::Completed, 'webhook', 'payment.succeeded', extra: [
                'paid_at' => now(),
                'gateway_response' => $data,
            ]);

            if ($payment->booking) {
                $payment->booking->update(['payment_status' => 'paid']);
            }
            return $payment;
        });

        if ($payment) {
            $this->notifyPayment($payment, 'completed');
        }
        // Self-healing settlement (MONEY-1/3): run for the Completed booking
        // charge whether THIS delivery transitioned it or a prior one did, so a
        // settlement a transient DB error dropped is retried on redelivery (a
        // throw leaves the WebhookEvent un-'processed'). Idempotent.
        $settleTarget = $payment
            ?? Payment::where('gateway_tx_id', $paymentRequestId)->where('status', PaymentStatus::Completed->value)->first();
        if ($settleTarget) {
            app(\App\Services\BookingSettlementService::class)->settlePaidBooking($settleTarget);
            return;
        }

        // No booking charge matched this payment_request — it may be a GCash/
        // Maya tip charge (its payment_request id is stored on the
        // 'tip_payment' row, which is also named in the charge's reference
        // "tip-{txId}"). Matched by reference too, whatever the row's state:
        // an older app build reused one row for every attempt, so a charge can
        // arrive for a row that now holds another one — completeGatewayTip
        // then refunds it to the customer's wallet instead of dropping it.
        // Idempotent, with its own settled-in-full + credit + notify.
        $tip = $this->findTipCharge($paymentRequestId, $data['reference_id'] ?? null);
        if ($tip) {
            app(\App\Services\WalletService::class)->completeGatewayTip($tip->id, $data);
            return;
        }

        // Legacy: a direct e-wallet wallet top-up started before top-ups were
        // retired (its payment_request id is stored as gateway_ref).
        // completeTopUp does its own settled-in-full guard + credit + notify,
        // and is idempotent.
        $topup = \App\Models\WalletTransaction::where('type', 'top_up')
            ->where('gateway_ref', $paymentRequestId)
            ->where('status', 'pending')
            ->first();
        if ($topup) {
            app(\App\Services\WalletService::class)->completeTopUp($topup->id, $data);
        }
    }

    /**
     * The 'tip_payment' row a Payment Requests charge belongs to: by the
     * charge id stored on the row, else by the "tip-{txId}" reference the
     * charge was created with.
     */
    private function findTipCharge(string $paymentRequestId, mixed $reference): ?\App\Models\WalletTransaction
    {
        $tip = \App\Models\WalletTransaction::where('type', 'tip_payment')
            ->where('gateway_ref', $paymentRequestId)
            ->first();
        if ($tip) {
            return $tip;
        }

        if (is_string($reference) && str_starts_with($reference, 'tip-')) {
            return \App\Models\WalletTransaction::where('type', 'tip_payment')
                ->whereKey(substr($reference, 4))
                ->first();
        }

        return null;
    }

    private function handlePaymentFailed(array $data): void
    {
        $paymentRequestId = $data['payment_request_id'] ?? null;
        if (!$paymentRequestId) {
            return;
        }

        $payment = DB::transaction(function () use ($paymentRequestId, $data) {
            $payment = Payment::where('gateway_tx_id', $paymentRequestId)
                ->lockForUpdate()
                ->first();

            if (!$payment || !$this->canAdvance($payment, PaymentStatus::Failed)) {
                return null;
            }

            $payment->transitionTo(PaymentStatus::Failed, 'webhook', 'payment.failed', extra: [
                'gateway_response' => $data,
            ]);

            // Reconcile the booking's payment_status like the sibling handlers
            // do (invoice.paid → 'paid', invoice.expired → 'expired'). Without
            // this an abandoned saved-method auth left payment=Failed but
            // booking payment_status='pending' forever — an inconsistent pair.
            // ...but never DOWNGRADE a booking whose money actually arrived: a
            // first attempt that fails after a second one succeeded would
            // otherwise mark a genuinely paid errand unpaid.
            if ($payment->booking && ! in_array($payment->booking->payment_status, ['paid', 'refunded'], true)) {
                $payment->booking->update(['payment_status' => 'failed']);
            }

            return $payment;
        });

        if ($payment) {
            // Cancel first, so the notice can say whether the errand ended.
            app(\App\Services\BookingSettlementService::class)->cancelUnpaidBooking($payment);
            $this->notifyPayment($payment, 'failed');
            return;
        }

        // No booking charge — a GCash/Maya tip charge may have failed. Fail its
        // pending row so the app stops verifying (no runner credit ever
        // happened). Only the row's OWN charge: a failure of a charge some
        // other attempt has since replaced changes nothing.
        $tip = \App\Models\WalletTransaction::where('type', 'tip_payment')
            ->where('gateway_ref', $paymentRequestId)
            ->where('status', 'pending')
            ->first();
        if ($tip) {
            app(\App\Services\WalletService::class)->expireGatewayTip($tip->id, 'Payment failed');
            return;
        }

        // Legacy: a direct e-wallet top-up (started before top-ups were
        // retired) failed. Mark it failed so the app stops "verifying".
        // Idempotent: a non-pending top-up is untouched.
        $topup = \App\Models\WalletTransaction::where('type', 'top_up')
            ->where('gateway_ref', $paymentRequestId)
            ->where('status', 'pending')
            ->first();
        if ($topup) {
            app(\App\Services\WalletService::class)->expireTopUp($topup->id, 'Payment failed');
        }
    }

    private function handlePaymentPending(array $data): void
    {
        $paymentRequestId = $data['payment_request_id'] ?? null;
        if (!$paymentRequestId) {
            return;
        }

        DB::transaction(function () use ($paymentRequestId, $data) {
            $payment = Payment::where('gateway_tx_id', $paymentRequestId)
                ->lockForUpdate()
                ->first();

            // Only advance a brand-new charge into 'processing'. If it's already
            // processing or terminal, this stale/out-of-order event is a no-op.
            if (!$payment || $payment->status !== PaymentStatus::Pending->value) {
                return;
            }

            $payment->transitionTo(PaymentStatus::Processing, 'webhook', 'payment.pending', extra: [
                'gateway_response' => $data,
            ]);
        });
    }

    private function handleRefundSucceeded(array $data): void
    {
        $referenceId = $data['reference_id'] ?? null;
        if (!$referenceId || !str_starts_with($referenceId, 'refund-')) {
            return;
        }

        $paymentId = substr($referenceId, 7);

        DB::transaction(function () use ($paymentId, $data) {
            $payment = Payment::where('id', $paymentId)
                ->lockForUpdate()
                ->first();

            if (!$payment || $payment->status === PaymentStatus::Refunded->value) {
                return;
            }

            // A refund is only meaningful for a completed charge. Anything else
            // is out-of-order noise — acknowledge without a (would-be illegal)
            // transition.
            if ($payment->status !== PaymentStatus::Completed->value) {
                Log::warning('Xendit refund.succeeded for a non-completed payment; ignoring', [
                    'payment_id' => $payment->id,
                    'status' => $payment->status,
                ]);
                return;
            }

            // Clamp the recorded refund to the original charge. The gateway
            // figure is caller-declared; persisting it unbounded would let a
            // malformed/tampered payload write a refund_amount larger than was
            // ever charged, corrupting the refunded-total reporting stat and the
            // transition audit row. Legitimate refunds are inherently <= charge.
            $chargeAmount = (float) $payment->amount;
            $refundAmount = min((float) ($data['amount'] ?? $chargeAmount), $chargeAmount);
            if (isset($data['amount']) && (float) $data['amount'] > $chargeAmount) {
                Log::critical('Xendit refund.succeeded amount EXCEEDS charge — clamped to charge', [
                    'payment_id' => $payment->id,
                    'booking_id' => $payment->booking_id,
                    'charge' => $chargeAmount,
                    'gateway_refund' => (float) $data['amount'],
                ]);
            }
            $payment->transitionTo(PaymentStatus::Refunded, 'webhook', 'refund.succeeded', extra: [
                'refund_amount' => $refundAmount,
                'refunded_at' => now(),
                'gateway_response' => $data,
            ]);
        });
    }

    /**
     * True only if the payment can legally advance to $to from its current
     * state. This is the webhook-ordering guard: an event that would move an
     * already-settled (or wrong-state) payment is a no-op, NOT an illegal
     * transition — Xendit delivers events out of order and redelivers freely.
     */
    private function canAdvance(Payment $payment, PaymentStatus $to): bool
    {
        $current = PaymentStatus::tryFrom((string) $payment->status);
        return $current !== null && $current->canTransitionTo($to);
    }

    /**
     * Reconciliation tripwire: the amount Xendit says it settled must match what
     * we expected to charge. A mismatch means a pricing/gateway bug or tampering
     * upstream. We only LOG (critical) — the webhook token already authenticates
     * the caller and invoices are fixed-amount, so we don't refuse the
     * settlement here; the alert lets ops reconcile before money is lost.
     */
    /**
     * Is the gateway-confirmed amount enough to mark this charge paid?
     *
     * Returns false for an UNDER-settlement (gateway confirmed LESS than we
     * charged): the webhook must then leave the payment pending for the pull
     * reconciler / a human rather than mark a short-paid booking as fully paid
     * (payment review P0-9 / audit H10). Mirrors reconcileBookingPayment, which
     * already refuses short settlements. Over-settlement is logged but allowed
     * (the customer overpaid — not a money-safety risk to complete). A missing
     * amount means the event carried nothing to compare, so we trust it.
     */
    private function settledInFull(Payment $payment, array $data): bool
    {
        $confirmed = $data['paid_amount'] ?? $data['amount'] ?? null;
        if ($confirmed === null) {
            // NOTE: invoice.paid events legitimately reach here WITHOUT a
            // paid_amount/amount in `data` (the invoice path carries the figure
            // elsewhere), and are expected to settle — so this MUST stay
            // fail-open. A prior attempt to fail-closed here broke real invoice
            // completions (see PaymentSafetyFoundationTest::webhook_records...).
            // Hardening the missing-amount case safely requires first confirming
            // the real Xendit invoice.paid payload shape and cross-checking the
            // amount from wherever the invoice actually carries it.
            return true;
        }

        $settled = (float) $confirmed;

        if ($settled + 0.01 < (float) $payment->amount) {
            Log::critical('Xendit settlement BELOW charged — left pending for review, NOT marked paid', [
                'payment_id' => $payment->id,
                'booking_id' => $payment->booking_id,
                'expected' => (float) $payment->amount,
                'gateway_confirmed' => $settled,
            ]);
            return false;
        }

        if (abs($settled - (float) $payment->amount) > 0.01) {
            Log::critical('Xendit settlement amount mismatch (over-settled)', [
                'payment_id' => $payment->id,
                'booking_id' => $payment->booking_id,
                'expected' => (float) $payment->amount,
                'gateway_confirmed' => $settled,
            ]);
        }

        return true;
    }

    /**
     * Fire a user-facing notification for a settled/failed payment. Runs AFTER
     * the DB transaction has committed (it makes an outbound push call — never
     * hold a row lock across the network). Booking context is re-read here.
     *
     * A declined or expired charge has already cancelled its errand
     * (cancelUnpaidBooking runs first), and that errand can't be paid again —
     * so the notice says it was cancelled and how to book it again, never "try
     * again". A stale failure on an errand that another attempt already paid
     * just says nothing was charged for it.
     *
     * @param  'completed'|'failed'|'expired'  $status
     */
    private function notifyPayment(Payment $payment, string $status): void
    {
        $amount = number_format((float) $payment->amount, 2);
        $booking = $payment->booking()->first(['id', 'booking_number', 'status']);
        $bookingNo = $booking?->booking_number;
        $for = $bookingNo ? " for errand #{$bookingNo}" : '';
        $missed = $status === 'expired'
            ? "Your ₱{$amount} payment{$for} wasn't completed in time"
            : "Your ₱{$amount} payment{$for} didn't go through";

        [$title, $body] = match ($status) {
            'completed' => ['Payment confirmed', "Your ₱{$amount} payment{$for} is confirmed."],
            default => [
                $status === 'expired' ? 'Payment expired' : 'Payment failed',
                $booking?->status === 'cancelled'
                    ? "{$missed}, so the errand was cancelled. You weren't charged — to try again, book the errand again."
                    : "{$missed}. You weren't charged for it.",
            ],
        };

        // Enqueue rather than send inline: this runs on the webhook thread, and a
        // synchronous Expo/FCM call here would block the 200 ACK back to Xendit
        // (a slow push → Xendit timeout → redelivery). SendPushJob does the
        // in-app row + device push off-thread. (PERF-BE-1 / SCALE-REL-3)
        \App\Jobs\SendPushJob::dispatch($payment->customer_id, $title, $body, [
            'type' => 'payment',
            'status' => $status,
            'booking_id' => $payment->booking_id,
            'payment_id' => $payment->id,
        ]);
    }
}
