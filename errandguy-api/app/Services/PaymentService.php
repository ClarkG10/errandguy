<?php

namespace App\Services;

use App\Enums\PaymentStatus;
use App\Exceptions\PaymentGatewayException;
use App\Models\Payment;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PaymentService
{
    /**
     * Minimum seconds between synchronous gateway pulls for the SAME payment
     * during status polling. The app polls every ~3s during checkout and each
     * pull is a blocking Xendit GET (up to a 25s timeout) that occupies an
     * FPM worker; at scale many concurrent checkouts can drain the pool. The
     * webhook remains the primary, real-time settlement path (it advances the
     * row directly), so pulling at most once per this window loses no
     * freshness — between pulls the poll returns the current DB state.
     */
    private const RECONCILE_PULL_THROTTLE_SECONDS = 10;

    private string $baseUrl;
    private string $secretKey;

    public function __construct()
    {
        $this->baseUrl = 'https://api.xendit.co';
        $this->secretKey = config('services.xendit.secret_key');
    }

    /**
     * Authenticated Xendit HTTP client with explicit timeouts. Without these,
     * Guzzle waits indefinitely — a slow/hanging Xendit call would tie up the
     * PHP worker until nginx/Cloudflare gives up with a 502. With them, the
     * call fails fast and surfaces as a clean caught error instead.
     */
    private function http(?string $idempotencyKey = null): \Illuminate\Http\Client\PendingRequest
    {
        // 25s was too generous for a SYNCHRONOUS, user-facing checkout-creation
        // call on the booking path: a Xendit brownout at peak could pin the whole
        // PHP-FPM pool for 25s each and cascade 502s across every endpoint.
        // Xendit normally responds in <3s; 12s bounds the blast radius while
        // leaving ample headroom (a timeout fails fast into the caught-error path,
        // idempotency-key-safe to retry). (audit perf)
        $client = Http::withBasicAuth($this->secretKey, '')
            ->connectTimeout(8)
            ->timeout(12);

        // Gateway-level idempotency: a retried charge/payout/refund creation
        // that carries the same key collapses to the SAME Xendit object rather
        // than creating a second one. Keys are derived deterministically from a
        // pre-created row id (see call sites) so they're stable across retries.
        if (! blank($idempotencyKey)) {
            $client = $client->withHeaders(['Idempotency-key' => $idempotencyKey]);
        }

        return $client;
    }

    /**
     * Start a one-time GCash or Maya charge (Xendit Payment Requests). The
     * returned `actions` carry the URL that deep-links into the e-wallet app.
     * The only online methods are GCash and Maya; cards and GrabPay are
     * retired.
     */
    public function createPaymentRequest(float $amount, string $referenceId, string $method, string $description = '', ?string $successRedirectUrl = null, ?string $failureRedirectUrl = null): array
    {
        $channelCode = match ($method) {
            'gcash' => 'GCASH',
            'maya' => 'PAYMAYA',
            default => throw new \InvalidArgumentException("Unsupported online payment method: {$method}"),
        };

        $payload = [
            'reference_id' => $referenceId,
            'amount' => round($amount, 2),
            'currency' => 'PHP',
            'description' => $description,
            'payment_method' => [
                'type' => 'EWALLET',
                'reusability' => 'ONE_TIME_USE',
                'ewallet' => [
                    'channel_code' => $channelCode,
                    'channel_properties' => [
                        'success_return_url' => $successRedirectUrl ?? config('app.url') . '/payment/success',
                        'failure_return_url' => $failureRedirectUrl ?? config('app.url') . '/payment/failed',
                    ],
                ],
            ],
        ];

        $response = $this->http("pr-{$referenceId}")
            ->post("{$this->baseUrl}/payment_requests", $payload);

        if (!$response->successful()) {
            $body = $response->json();
            Log::error('Xendit: Failed to create payment request', [
                'status' => $response->status(),
                'response' => $body,
            ]);
            throw new PaymentGatewayException(
                'Failed to create payment request.',
                is_array($body) ? ($body['message'] ?? null) : null,
                is_array($body) ? ($body['error_code'] ?? null) : null,
            );
        }

        return $response->json();
    }

    /**
     * Pull the customer-facing authorization URL out of a Xendit
     * payment-request `actions` array (the GCash/Maya authorize step).
     */
    public static function extractActionUrl(array $data): ?string
    {
        foreach ($data['actions'] ?? [] as $action) {
            $url = $action['url'] ?? ($action['value'] ?? null);
            if ($url) {
                return $url;
            }
        }

        return null;
    }

    /**
     * Send a pending payout to a bank / e-wallet via Xendit Payouts (v2).
     *
     * Money-safe: the wallet is already debited when the payout row is created,
     * so we do NOT mark it completed here — the payout.succeeded /
     * payout.failed webhook (or a fresh lookup) settles it, and a failure
     * re-credits the wallet. Idempotency-key = po-{tx} so a retry collapses to
     * the same Xendit payout instead of double-sending real money.
     *
     * The row is marked SENT (payout_sent_at) and the destination actually used
     * is recorded on it BEFORE the request leaves, under a row lock:
     *   • it can't be sent twice (a second send finds it already sent);
     *   • if Xendit's answer never arrives (timeout, crash) the payout still
     *     reads as sent, so nobody can mark it failed by hand and re-credit a
     *     wallet Xendit is paying out of — only a fresh lookup can settle it;
     *   • only a definite rejection (a 4xx: nothing was created) clears the
     *     mark again so the payout can be corrected and re-sent.
     *
     * @throws \RuntimeException on a rejection or an unanswered send (the
     *                           message says which).
     */
    public function createPayout(string $walletTxId, string $channelCode, string $accountNumber, string $accountHolderName): array
    {
        if (blank($this->secretKey)) {
            throw new \RuntimeException('Xendit is not configured (XENDIT_SECRET_KEY empty).');
        }

        $tx = DB::transaction(function () use ($walletTxId, $channelCode, $accountNumber, $accountHolderName) {
            $tx = \App\Models\WalletTransaction::where('type', 'payout')->lockForUpdate()->findOrFail($walletTxId);

            if ($tx->status !== 'pending') {
                throw new \RuntimeException('Only a pending payout can be sent.');
            }
            if ($tx->isSentToGateway()) {
                throw new \RuntimeException('This payout was already sent to Xendit. Use “Check with Xendit” to see where it is.');
            }

            // What is actually sent is what the payout records from now on
            // (staff may have corrected the requested details).
            $channel = \App\Support\PayoutDestination::channelForCode($channelCode) ?? 'bank';
            $recordedBank = $this->recordedDestination($tx)['bank_name'] ?? null;
            $tx->forceFill([
                'payout_sent_at' => now(),
                'payout_destination' => \App\Support\PayoutDestination::make(
                    $channel,
                    $accountNumber,
                    $accountHolderName,
                    $channel === 'bank' ? ($recordedBank ?? \App\Support\PayoutDestination::CHANNEL_CODES[$channelCode] ?? null) : null,
                    $channelCode,
                ),
            ])->save();

            return $tx;
        });

        // Send exactly what was recorded (spaces/dashes stripped, +63 → 0).
        $accountNumber = (string) $tx->payout_destination['account_number'];

        $amount = abs((float) $tx->amount);

        try {
            $response = $this->http("po-{$tx->id}")
                ->post("{$this->baseUrl}/v2/payouts", [
                    'reference_id' => "payout-{$tx->id}",
                    'channel_code' => $channelCode,
                    'channel_properties' => [
                        'account_holder_name' => $accountHolderName,
                        'account_number' => $accountNumber,
                    ],
                    'amount' => round($amount, 2),
                    'currency' => 'PHP',
                    'description' => 'ErrandGuy payout',
                ]);
        } catch (\Throwable $e) {
            Log::error('Xendit: payout request went unanswered — left marked as sent', [
                'wallet_tx' => $tx->id,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(
                'Xendit didn’t answer, so we can’t tell yet whether this payout went out. It stays marked as sent — '
                .'use “Check with Xendit” in a few minutes before doing anything else.',
                previous: $e,
            );
        }

        if (! $response->successful()) {
            Log::error('Xendit: payout request failed', [
                'wallet_tx' => $tx->id,
                'status' => $response->status(),
                'response' => $response->json(),
            ]);

            // A 4xx is a definite rejection — Xendit created nothing — so the
            // payout goes back to "not sent" and can be fixed and re-sent. A
            // 5xx is not definite: it stays marked as sent until a lookup says.
            // 409 is the exception: a duplicate idempotency key / reference
            // means a payout under this id already EXISTS at Xendit, so it must
            // stay marked as sent or it could be sent twice.
            if ($response->clientError() && $response->status() !== 409) {
                \App\Models\WalletTransaction::whereKey($tx->id)
                    ->whereNull('gateway_ref')
                    ->update(['payout_sent_at' => null]);

                throw new \RuntimeException($response->json('message') ?? 'Xendit rejected this payout.');
            }

            throw new \RuntimeException(
                'Xendit had a problem, so we can’t tell yet whether this payout went out. It stays marked as sent — '
                .'use “Check with Xendit” in a few minutes before doing anything else.'
            );
        }

        $data = $response->json();

        // Record the gateway payout id so the webhook can settle this row; it
        // stays 'pending' until payout.succeeded / payout.failed arrives.
        \App\Models\WalletTransaction::whereKey($tx->id)->update(['gateway_ref' => $data['id'] ?? $tx->gateway_ref]);

        return $data;
    }

    /** The destination recorded on a payout, or null (none, or unreadable). */
    private function recordedDestination(\App\Models\WalletTransaction $tx): ?array
    {
        try {
            return $tx->payout_destination;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Authoritative status read for a payout already sent to Xendit.
     *
     * The counterpart to getPaymentRequest() on the money-OUT side. createPayout
     * leaves the row `pending` for the payout.succeeded / payout.failed webhook;
     * this is the pull path for when that webhook never arrives (the wallet is
     * already debited at creation) — see WalletService::refreshSentPayout.
     *
     * @return array<string,mixed>
     */
    public function getPayout(string $payoutId): array
    {
        $response = $this->http()->get("{$this->baseUrl}/v2/payouts/{$payoutId}");

        if (! $response->successful()) {
            throw new \RuntimeException('Failed to retrieve payout.');
        }

        return $response->json();
    }

    /**
     * Find a payout by the reference it was sent with ("payout-{tx}") — for a
     * send whose answer never came back, so we never learned its Xendit id.
     *
     * @return array<string,mixed>|null  the payout, or null if Xendit has none
     */
    public function findPayoutByReference(string $referenceId): ?array
    {
        $response = $this->http()->get("{$this->baseUrl}/v2/payouts", ['reference_id' => $referenceId]);

        if (! $response->successful()) {
            throw new \RuntimeException('Failed to look up payout.');
        }

        $payouts = $response->json();
        $first = is_array($payouts) ? (array_is_list($payouts) ? ($payouts[0] ?? null) : ($payouts['data'][0] ?? null)) : null;

        return is_array($first) ? $first : null;
    }

    /**
     * Issue a REAL, FULL gateway reversal to source via Xendit.
     *
     * Legacy: only card payments are refunded this way (staff "Refund" on the
     * Payments page), and cards are retired — this stays for card payments
     * made before that. GCash/Maya refunds go to the wallet (refundToWallet).
     *
     * Locked + status-guarded: the payment row is locked for the duration so
     * concurrent refunds of the same payment serialize, and a second attempt
     * no-ops once it is Refunded (this closes the over-refund window). Partial
     * refunds are intentionally NOT supported here — they require the P2 refunds
     * ledger to stay reconcilable and to avoid the cancel-path double-refund;
     * full-only keeps the record and the cancel path unambiguous. Stamps
     * refunded_to='gateway' and syncs booking.payment_status. Only for an
     * errand that is over (lockEndedBooking).
     *
     * @throws \RuntimeException if the payment has no gateway charge or is not
     *         completed, or its errand is still in progress.
     */
    public function refundPayment(string $paymentId, ?float $amount = null, string $reason = 'REQUESTED_BY_CUSTOMER'): array
    {
        return DB::transaction(function () use ($paymentId, $reason) {
            $this->lockEndedBooking($paymentId);
            $payment = Payment::whereKey($paymentId)->lockForUpdate()->firstOrFail();

            if (blank($payment->gateway_tx_id)) {
                throw new \RuntimeException('This payment has no gateway charge to reverse; use a wallet refund instead.');
            }
            if ($payment->status !== PaymentStatus::Completed->value) {
                throw new \RuntimeException('Only a completed payment can be refunded.');
            }

            $amount = round((float) $payment->amount, 2);

            $response = $this->http("rf-{$payment->id}")
                ->post("{$this->baseUrl}/refunds", [
                    'payment_request_id' => $payment->gateway_tx_id,
                    'amount' => $amount,
                    'currency' => 'PHP',
                    'reason' => $reason,
                    'reference_id' => "refund-{$payment->id}",
                ]);

            if (! $response->successful()) {
                Log::error('Xendit: Failed to process refund', [
                    'payment' => $payment->id,
                    'response' => $response->json(),
                ]);
                throw new \RuntimeException($response->json('message') ?? 'Failed to process refund.');
            }

            $this->recordRefund($payment, 'gateway', $amount, $reason);

            return $response->json();
        });
    }

    /**
     * Refund a completed payment IN FULL to the customer's ErrandGuy wallet.
     * Used for wallet-funded charges and — per the hybrid policy — GCash/Maya
     * online charges (Xendit can't reliably reverse those to source). REJECTS
     * cash: the platform never held that money (the customer paid the runner
     * directly), so there is nothing to refund. Locked + status-guarded; the
     * wallet credit is idempotent keyed on the PAYMENT id (not the booking id,
     * which would collide with the lifecycle cancel refunds). Stamps
     * refunded_to='wallet' so records never imply a reversal that didn't happen.
     * Only for an errand that is over (lockEndedBooking).
     */
    public function refundToWallet(string $paymentId, string $reason = 'REQUESTED_BY_CUSTOMER'): void
    {
        DB::transaction(function () use ($paymentId, $reason) {
            $this->lockEndedBooking($paymentId);
            $payment = Payment::whereKey($paymentId)->lockForUpdate()->firstOrFail();

            if ($payment->method === 'cash') {
                throw new \RuntimeException('Cash is settled directly with the runner; there is nothing for the platform to refund.');
            }
            if ($payment->status !== PaymentStatus::Completed->value) {
                throw new \RuntimeException('Only a completed payment can be refunded to wallet.');
            }

            $amount = round((float) $payment->amount, 2);
            // Refund row is keyed on the PAYMENT id (idempotent-distinct from the
            // booking-keyed cancel refunds), but the ORIGINAL wallet debit was
            // recorded under the BOOKING id — pass it so the bonus/withdrawable
            // split is recovered and non-withdrawable bonus is not laundered into
            // cashable wallet balance (payment review follow-up).
            app(WalletService::class)->refund($payment->customer_id, $amount, $payment->id, $payment->booking_id);

            $this->recordRefund($payment, 'wallet', $amount, $reason);
        });
    }

    /**
     * Staff refunds are for an errand that is over — completed, cancelled or
     * ended with no runner. While it is still live (matching is looking, or a
     * runner is working it) a refund would leave it running for free and the
     * runner paid by the platform at completion; cancelling the errand is the
     * way to stop it, and cancelling refunds the customer.
     *
     * Locks the booking BEFORE the payment (the order refundUnfulfilled and
     * the cancel paths take), so a staff refund racing a cancel or a
     * completion serializes on the booking and sees its settled status.
     *
     * @throws \RuntimeException when the errand is still in progress.
     */
    private function lockEndedBooking(string $paymentId): void
    {
        $bookingId = Payment::whereKey($paymentId)->value('booking_id');
        if (! $bookingId) {
            return;
        }

        $booking = \App\Models\Booking::whereKey($bookingId)->lockForUpdate()->first(['id', 'status']);
        if ($booking && ! in_array($booking->status, \App\Enums\BookingStatus::ENDED, true)) {
            throw new \RuntimeException(
                'This errand is still in progress, so its payment can’t be refunded here. '
                .'Cancel the errand instead — cancelling refunds the customer.'
            );
        }
    }

    /**
     * Shared post-refund bookkeeping (full refund). refund_amount + refunded_to
     * are money fields written directly; the status move goes through the guarded
     * transitionTo (idempotent no-op if already Refunded). Syncs
     * booking.payment_status='refunded' — which a real gateway refund previously
     * never did (payment review P0-5) and which also makes the refund visible to
     * the cancel path so it can never double-refund.
     */
    private function recordRefund(Payment $payment, string $refundedTo, float $amount, string $reason): void
    {
        $payment->forceFill([
            'refund_amount' => $amount,
            'refunded_at' => now(),
            'refunded_to' => $refundedTo,
        ])->save();

        if ($payment->status !== PaymentStatus::Refunded->value) {
            $payment->transitionTo(PaymentStatus::Refunded, actor: 'system', reason: $reason, meta: [
                'refund_amount' => $amount,
                'refunded_to' => $refundedTo,
            ]);
        }

        if ($payment->booking_id) {
            \App\Models\Booking::whereKey($payment->booking_id)->update(['payment_status' => 'refunded']);
        }
    }

    public function getPaymentRequest(string $paymentRequestId): array
    {
        $response = $this->http()
            ->get("{$this->baseUrl}/payment_requests/{$paymentRequestId}");

        if (!$response->successful()) {
            throw new \RuntimeException('Failed to retrieve payment request.');
        }

        return $response->json();
    }

    /**
     * Pull-based settlement reconciliation for a booking's gateway charge.
     *
     * Production settles via the `payment.succeeded` webhook, but a webhook can
     * be delayed, dropped, or — in local dev — simply never reach the server,
     * leaving a genuinely-paid charge stuck at `processing` so the app's status
     * poll can never confirm it. This asks Xendit for the payment request's REAL
     * status and advances the Payment through the SAME audited `transitionTo`
     * path the webhook uses (never a raw update), so settlement is confirmed
     * without depending on webhook delivery.
     *
     * Safe to call on every status poll:
     *   • no-op unless the charge is a non-terminal gateway payment with a ref;
     *   • a gateway hiccup NEVER fails the poll (leaves it pending, retries next);
     *   • row-locked + re-checked so concurrent polls / a racing webhook can't
     *     double-advance the same charge (transitionTo also no-ops once terminal);
     *   • only ever moves the Payment to the state the gateway itself reports;
     *   • refuses to mark paid for LESS than we charged.
     */
    public function reconcileBookingPayment(Payment $payment, ?int $throttleSeconds = null): Payment
    {
        // Only a non-terminal gateway charge can be reconciled. Cash/wallet
        // settle locally; a terminal payment is already resolved; a blank
        // gateway ref means the charge never reached Xendit (create failed).
        if (
            ! in_array($payment->status, [PaymentStatus::Pending->value, PaymentStatus::Processing->value], true)
            || in_array($payment->method, ['cash', 'wallet'], true)
            || blank($payment->gateway_tx_id)
        ) {
            return $payment;
        }

        // Rate-limit the blocking gateway pull per-payment. The first poll in
        // each window pulls; polls arriving inside the window skip the Xendit
        // GET and return the current DB state (kept live by the webhook). This
        // caps FPM-worker occupancy during checkout without delaying real
        // settlement. Cache::add is the throttle latch — it succeeds only when
        // the key is absent, so exactly one poll per window wins the pull.
        // (On the file cache this is best-effort under a rare race; on Redis
        // — see the Tier-0 rollout — it becomes a truly atomic SET NX.)
        // A scheduled sweep passes 0 so it is never silenced by the polling
        // endpoint's latch — a stranded charge is precisely the case where
        // nobody is polling; the sweep's own cadence + --limit bound the load.
        $throttle = $throttleSeconds ?? self::RECONCILE_PULL_THROTTLE_SECONDS;
        if ($throttle > 0 && ! Cache::add("payment_reconcile_pull:{$payment->id}", 1, $throttle)) {
            return $payment;
        }

        try {
            $pr = $this->getPaymentRequest($payment->gateway_tx_id);
        } catch (\Throwable $e) {
            // Gateway unreachable / transient — never fail the poll.
            return $payment;
        }

        $gatewayStatus = strtoupper((string) ($pr['status'] ?? ''));
        if (! in_array($gatewayStatus, ['SUCCEEDED', 'FAILED', 'EXPIRED'], true)) {
            // PENDING / REQUIRES_ACTION — the customer hasn't finished paying.
            return $payment;
        }

        try {
            $result = DB::transaction(function () use ($payment, $pr, $gatewayStatus) {
                // Row-lock + re-read so two concurrent polls (or a poll racing
                // the webhook) can't both advance the same charge.
                $locked = Payment::whereKey($payment->id)->lockForUpdate()->first();
                if (
                    ! $locked
                    || ! in_array($locked->status, [PaymentStatus::Pending->value, PaymentStatus::Processing->value], true)
                ) {
                    return $locked ?? $payment;
                }

                if ($gatewayStatus === 'SUCCEEDED') {
                    // Never mark paid for LESS than we charged. A short settle is
                    // left pending for the webhook / a human to resolve.
                    $settled = (float) ($pr['amount'] ?? 0);
                    if ($settled > 0 && $settled + 0.01 < (float) $locked->amount) {
                        Log::warning('Xendit reconcile: settled amount below charged — left pending', [
                            'payment_id' => $locked->id,
                            'charged' => (float) $locked->amount,
                            'settled' => $settled,
                        ]);
                        return $locked;
                    }
                    $locked->transitionTo(PaymentStatus::Completed, 'reconcile', 'payment_request.succeeded', extra: [
                        'paid_at' => now(),
                        'gateway_response' => $pr,
                    ]);
                    if ($locked->booking) {
                        $locked->booking->update(['payment_status' => 'paid']);
                    }
                } elseif ($gatewayStatus === 'FAILED') {
                    $locked->transitionTo(PaymentStatus::Failed, 'reconcile', 'payment_request.failed', extra: [
                        'gateway_response' => $pr,
                    ]);
                    // Mirror the webhook: sync the booking. The pull reconciler
                    // ALWAYS wins over the webhook in dev/test (no webhooks) and
                    // whenever the webhook lags — once it terminalizes the charge,
                    // the later webhook no-ops (canAdvance=false), so the sync
                    // must happen here too.
                    // Never DOWNGRADE a booking whose money actually arrived. A
                    // customer whose first attempt fails and who then pays with a
                    // second one leaves attempt #1 to terminalize later; writing
                    // 'failed' then would mark a genuinely paid errand unpaid and
                    // (via the teardown below) could cancel it.
                    if ($locked->booking && ! in_array($locked->booking->payment_status, ['paid', 'refunded'], true)) {
                        $locked->booking->update(['payment_status' => 'failed']);
                    }
                } else { // EXPIRED
                    $locked->transitionTo(PaymentStatus::Expired, 'reconcile', 'payment_request.expired', extra: [
                        'gateway_response' => $pr,
                    ]);
                    // Same no-downgrade rule as the FAILED branch above.
                    if ($locked->booking && ! in_array($locked->booking->payment_status, ['paid', 'refunded'], true)) {
                        $locked->booking->update(['payment_status' => 'expired']);
                    }
                }

                return $locked;
            });

            // AFTER commit: if this poll is what settled the charge, act on it —
            // start matching for an errand that was waiting for this payment,
            // auto-refund a charge that landed on an already-cancelled booking,
            // or back-fill a runner earning the errand's completion couldn't
            // credit (MONEY-1 / MONEY-3 / MONEYX-2). Never let this fail the
            // status poll.
            if ($result instanceof Payment && $result->status === PaymentStatus::Completed->value) {
                try {
                    app(\App\Services\BookingSettlementService::class)->settlePaidBooking($result);
                } catch (\Throwable $e) {
                    Log::warning('Post-settlement resolution failed after reconcile', [
                        'payment_id' => $result->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            // ...and the mirror for a charge that will never arrive. This poll
            // ALWAYS beats the webhook when the customer declines in-app (the app
            // polls every 3s from the moment checkout opens), and terminalizing
            // the charge here permanently disarms the webhook's own teardown
            // (canAdvance=false ⇒ its post-commit block never runs). So this is
            // where the most common abandonment — open GCash, change your mind,
            // decline — cancels the errand and tells the customer. Idempotent +
            // race-safe (skips completed/cancelled/no_runner and anything
            // actually paid). Never fail the poll.
            if ($result instanceof Payment
                && in_array($result->status, [PaymentStatus::Failed->value, PaymentStatus::Expired->value], true)) {
                try {
                    app(\App\Services\BookingSettlementService::class)->cancelUnpaidBooking($result);
                } catch (\Throwable $e) {
                    Log::warning('Unpaid-booking teardown failed after reconcile', [
                        'payment_id' => $result->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            return $result;
        } catch (\Throwable $e) {
            // A transition/DB error must never 500 the status poll — the webhook
            // is still the primary settlement path. Log and report current state.
            Log::warning('Xendit reconcile failed', [
                'payment_id' => $payment->id,
                'error' => $e->getMessage(),
            ]);
            return $payment->fresh() ?? $payment;
        }
    }
}
