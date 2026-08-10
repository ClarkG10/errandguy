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
                // v2 invoices (used for wallet top-ups) may fire these events.
                'invoice.paid' => $this->handleInvoicePaid($data ?: $payload),
                'invoice.expired' => $this->handleInvoiceExpired($data ?: $payload),
                // Linked e-wallet lifecycle (Stage 2 saved methods).
                'payment_method.activated' => $this->handlePaymentMethodStatus($data, 'active'),
                'payment_method.expired' => $this->handlePaymentMethodStatus($data, 'expired'),
                'payment_method.failed' => $this->handlePaymentMethodStatus($data, 'failed'),
                // Runner payouts (Xendit Payouts v2). Success marks the payout
                // completed; failure/reversal re-credits the runner's wallet.
                'payout.succeeded' => $this->handlePayoutSucceeded($data),
                'payout.failed', 'payout.reversed' => $this->handlePayoutFailed($data),
                default => null,
            };
        } else {
            // Classic Xendit INVOICE webhook: the invoice object is POSTed FLAT
            // at the top level — { id, external_id, status: "PAID", ... }.
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
        if (! $tx || $tx->status !== 'pending') {
            return;
        }

        try {
            app(\App\Services\WalletService::class)->completePayout($tx->id);
        } catch (\App\Exceptions\PayoutStateException) {
            // Already settled by a racing delivery — no-op.
        }
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
            //   - pending   → failPayout re-credits and marks it failed.
            //   - completed → reversePayout re-credits and marks it reversed
            //     (this is the money-loss MONEYX-1 was: a reversal after success
            //     used to hit failPayout's pending-only guard and be dropped).
            if ($tx->status === 'pending') {
                $wallet->failPayout($tx->id, (string) $reason);
            } elseif ($tx->status === 'completed') {
                $wallet->reversePayout($tx->id, (string) $reason);
            }
            // else: already failed/reversed → no-op.
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
     * Invoice paid — wallet top-up ("topup-{txId}") or a booking hosted-invoice
     * charge ("booking-{paymentId}").
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
        // a tip never touches payment_status / referral / promo.
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
                $this->rewardReferralIfEligible($payment);
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
     * Invoice expired before it was paid — the customer never completed
     * checkout. Previously dropped; now moves the pending charge/top-up to a
     * truthful terminal state so the app stops "verifying" forever.
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
                if ($payment->booking) {
                    $payment->booking->update(['payment_status' => 'expired']);
                }
                return $payment;
            });

            if ($payment) {
                $this->notifyPayment($payment, 'expired');
                $this->unredeemBookingPromo($payment);
            }
        }
    }

    /**
     * Linked e-wallet lifecycle. Xendit sends the payment-method object; its
     * `id` is what we stored as gateway_ref when the customer started linking.
     */
    private function handlePaymentMethodStatus(array $data, string $status): void
    {
        $id = $data['id'] ?? null;
        if (! $id) {
            return;
        }

        \App\Models\PaymentMethod::where('gateway_ref', $id)->update(['status' => $status]);
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
            $this->rewardReferralIfEligible($payment);
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

        // No booking charge matched this payment_request — it may be a DIRECT
        // e-wallet wallet top-up (its payment_request id is stored on the
        // WalletTransaction as gateway_ref). completeTopUp does its own
        // settled-in-full guard + credit + notify, and is idempotent.
        $topup = \App\Models\WalletTransaction::where('type', 'top_up')
            ->where('gateway_ref', $paymentRequestId)
            ->where('status', 'pending')
            ->first();
        if ($topup) {
            app(\App\Services\WalletService::class)->completeTopUp($topup->id, $data);
            return;
        }

        // …or a DIRECT e-wallet gateway-funded tip (its payment_request id is
        // stored on the 'tip_payment' row). completeGatewayTip is idempotent
        // and does its own settled-in-full + runner-credit + notify.
        $tip = \App\Models\WalletTransaction::where('type', 'tip_payment')
            ->where('gateway_ref', $paymentRequestId)
            ->where('status', 'pending')
            ->first();
        if ($tip) {
            app(\App\Services\WalletService::class)->completeGatewayTip($tip->id, $data);
        }
    }

    /**
     * Re-attempt a referral reward once an online charge actually settles.
     *
     * A referral only qualifies on a genuinely-paid non-cash booking. If the
     * runner completed the errand BEFORE Xendit's webhook settled the charge
     * (webhook lag / late checkout), the booking-completed listener ran while
     * the Payment was still pending and no-op'd, permanently dropping the
     * reward. This closes that window. Runs AFTER commit; ReferralService::
     * reward is idempotent and re-checks the qualifying-booking gate itself.
     */
    private function rewardReferralIfEligible(?Payment $payment): void
    {
        $booking = $payment?->booking;
        if ($booking && $booking->status === 'completed' && $booking->customer_id) {
            try {
                app(\App\Services\ReferralService::class)->reward($booking->customer_id);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Referral reward re-attempt failed after settlement', [
                    'booking_id' => $booking->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }
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
            if ($payment->booking) {
                $payment->booking->update(['payment_status' => 'failed']);
            }

            return $payment;
        });

        if ($payment) {
            $this->notifyPayment($payment, 'failed');
            $this->unredeemBookingPromo($payment);
            return;
        }

        // No booking charge — a direct e-wallet top-up may have failed. Mark the
        // pending top-up failed so the app stops "verifying" (mirrors the
        // invoice.expired path). Idempotent: a non-pending top-up is untouched.
        $topup = \App\Models\WalletTransaction::where('type', 'top_up')
            ->where('gateway_ref', $paymentRequestId)
            ->where('status', 'pending')
            ->first();
        if ($topup) {
            app(\App\Services\WalletService::class)->expireTopUp($topup->id, 'Payment failed');
            return;
        }

        // …or a direct e-wallet gateway tip that failed — fail its pending row
        // too so the app stops verifying (no runner credit ever happened).
        $tip = \App\Models\WalletTransaction::where('type', 'tip_payment')
            ->where('gateway_ref', $paymentRequestId)
            ->where('status', 'pending')
            ->first();
        if ($tip) {
            app(\App\Services\WalletService::class)->expireGatewayTip($tip->id, 'Payment failed');
        }
    }

    /**
     * Reverse a promo redemption when an online booking's charge never settles
     * (invoice expired / payment failed). The redemption is incremented at
     * booking-create, so without this an abandoned online checkout would burn a
     * promo use forever (payment review P0-7). Safe against webhook replay: it
     * runs only in the post-commit block, which is reached only when the
     * terminal transition actually happened (canAdvance guards the replay).
     */
    private function unredeemBookingPromo(?Payment $payment): void
    {
        if ($payment?->booking_id) {
            app(\App\Services\PromoService::class)->unredeem($payment->booking_id);
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

            $payment->transitionTo(PaymentStatus::Refunded, 'webhook', 'refund.succeeded', extra: [
                'refund_amount' => ($data['amount'] ?? $payment->amount),
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
     * hold a row lock across the network). Booking context is lazy-loaded here.
     *
     * @param  'completed'|'failed'|'expired'  $status
     */
    private function notifyPayment(Payment $payment, string $status): void
    {
        $amount = number_format((float) $payment->amount, 2);
        $bookingNo = $payment->booking?->booking_number;
        $for = $bookingNo ? " for booking {$bookingNo}" : '';

        [$title, $body] = match ($status) {
            'completed' => ['Payment confirmed', "Your ₱{$amount} payment{$for} is confirmed."],
            'expired' => ['Payment expired', "Your payment window{$for} expired. You weren't charged — you can try again."],
            default => ['Payment failed', "We couldn't confirm your ₱{$amount} payment{$for}. You weren't charged — try again or use another method."],
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
