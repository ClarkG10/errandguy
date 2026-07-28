<?php

namespace App\Services;

use App\Enums\PaymentStatus;
use App\Exceptions\PaymentGatewayException;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\User;
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
        $client = Http::withBasicAuth($this->secretKey, '')
            ->connectTimeout(10)
            ->timeout(25);

        // Gateway-level idempotency: a retried charge/invoice/refund creation
        // that carries the same key collapses to the SAME Xendit object rather
        // than creating a second one. Keys are derived deterministically from a
        // pre-created row id (see call sites) so they're stable across retries.
        if (! blank($idempotencyKey)) {
            $client = $client->withHeaders(['Idempotency-key' => $idempotencyKey]);
        }

        return $client;
    }

    public function createPaymentRequest(float $amount, string $referenceId, string $method, string $description = '', ?string $successRedirectUrl = null, ?string $failureRedirectUrl = null): array
    {
        $payload = [
            'reference_id' => $referenceId,
            'amount' => round($amount, 2),
            'currency' => 'PHP',
            'description' => $description,
            'payment_method' => [
                'type' => $this->mapPaymentMethod($method),
                'reusability' => 'ONE_TIME_USE',
            ],
        ];

        if ($method === 'gcash' || $method === 'maya') {
            $payload['payment_method']['ewallet'] = [
                'channel_code' => $method === 'gcash' ? 'GCASH' : 'PAYMAYA',
                'channel_properties' => [
                    'success_return_url' => $successRedirectUrl ?? config('app.url') . '/payment/success',
                    'failure_return_url' => $failureRedirectUrl ?? config('app.url') . '/payment/failed',
                ],
            ];
        }

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

    public function createInvoice(float $amount, string $externalId, string $description = '', string $payerEmail = '', ?string $successRedirectUrl = null): array
    {
        // Fail fast with a clear reason if the key is missing (env not set, or
        // config cache not refreshed after setting it on the server).
        if (blank($this->secretKey)) {
            Log::error('Xendit: secret key is not configured (XENDIT_SECRET_KEY empty).');
            throw new PaymentGatewayException(
                'Failed to create invoice.',
                'XENDIT_SECRET_KEY is empty — set it in the server env and run `php artisan config:clear`.',
                'NOT_CONFIGURED',
            );
        }

        $payload = [
            'external_id' => $externalId,
            'amount' => round($amount, 2),
            'currency' => 'PHP',
            'description' => $description,
            // Intentionally NOT pinning `payment_methods`. Xendit then offers
            // every channel ACTIVATED on the account (GCash, Maya, cards, etc).
            // Hardcoding a list makes the WHOLE invoice fail if any one of
            // those channels isn't activated for the current mode.
        ];

        if ($payerEmail) {
            $payload['payer_email'] = $payerEmail;
        }

        if ($successRedirectUrl) {
            $payload['success_redirect_url'] = $successRedirectUrl;
        }

        $response = $this->http("inv-{$externalId}")
            ->post("{$this->baseUrl}/v2/invoices", $payload);

        if (!$response->successful()) {
            $body = $response->json();
            Log::error('Xendit: Failed to create invoice', [
                'status' => $response->status(),
                'response' => $body,
            ]);
            throw new PaymentGatewayException(
                'Failed to create invoice.',
                is_array($body) ? ($body['message'] ?? null) : null,
                is_array($body) ? ($body['error_code'] ?? null) : null,
            );
        }

        return $response->json();
    }

    // ── Linked / saved payment methods (Stage 2) ─────────────────────────────

    /**
     * Get (or lazily create) the Xendit customer for a user. Reusable payment
     * methods (linked e-wallets, saved cards) are tied to a customer.
     */
    public function getOrCreateXenditCustomer(User $user): string
    {
        if (! blank($user->xendit_customer_id)) {
            return $user->xendit_customer_id;
        }

        if (blank($this->secretKey)) {
            throw new PaymentGatewayException(
                'Payment gateway is not configured.',
                'XENDIT_SECRET_KEY is empty — set it in the server env and run `php artisan config:clear`.',
                'NOT_CONFIGURED',
            );
        }

        $response = $this->http()
            ->post("{$this->baseUrl}/customers", [
                'reference_id' => "user-{$user->id}",
                'type' => 'INDIVIDUAL',
                'individual_detail' => [
                    'given_names' => $user->name ?: ($user->first_name ?? 'ErrandGuy Customer'),
                ],
                'email' => $user->email ?: null,
            ]);

        if (! $response->successful()) {
            $body = $response->json();
            Log::error('Xendit: Failed to create customer', [
                'status' => $response->status(),
                'response' => $body,
            ]);
            throw new PaymentGatewayException(
                'Failed to set up your payment profile.',
                is_array($body) ? ($body['message'] ?? null) : null,
                is_array($body) ? ($body['error_code'] ?? null) : null,
            );
        }

        $customerId = (string) $response->json('id');
        $user->update(['xendit_customer_id' => $customerId]);

        return $customerId;
    }

    /**
     * Start linking a reusable e-wallet (GCash/Maya/GrabPay). Returns the
     * Xendit payment-method object; its `actions[].url` is where the customer
     * authorizes the link. The method becomes ACTIVE via the
     * `payment_method.activated` webhook.
     */
    public function createLinkedEwallet(User $user, string $channelCode, string $successUrl, string $failureUrl): array
    {
        if (blank($this->secretKey)) {
            throw new PaymentGatewayException(
                'Payment gateway is not configured.',
                'XENDIT_SECRET_KEY is empty — set it in the server env and run `php artisan config:clear`.',
                'NOT_CONFIGURED',
            );
        }

        $customerId = $this->getOrCreateXenditCustomer($user);

        // Xendit's e-wallet linking requires a `cancel_return_url` alongside
        // success/failure — a missing one is rejected with API_VALIDATION_ERROR
        // ("field 'cancel_return_url' is required"). Reuse the same in-app
        // return bridge for all three outcomes; the app re-checks the method's
        // status on any return, so cancel and failure can land the same place.
        $channelProperties = [
            'success_return_url' => $successUrl,
            'failure_return_url' => $failureUrl,
            'cancel_return_url' => $failureUrl,
        ];

        // GrabPay spans several SEA markets, so Xendit requires an explicit
        // `country` for it ("country is required for channel_code 'GRABPAY'").
        // GCash/Maya are PH-only and do NOT take this field, so scope it to
        // GrabPay to avoid rejecting those two.
        if ($channelCode === 'GRABPAY') {
            $channelProperties['country'] = 'PH';
        }

        $payload = [
            'type' => 'EWALLET',
            'reusability' => 'MULTIPLE_USE',
            'customer_id' => $customerId,
            'ewallet' => [
                'channel_code' => $channelCode,
                'channel_properties' => $channelProperties,
            ],
        ];

        $response = $this->http()
            ->post("{$this->baseUrl}/v2/payment_methods", $payload);

        if (! $response->successful()) {
            $body = $response->json();
            Log::error('Xendit: Failed to link e-wallet', [
                'status' => $response->status(),
                'channel' => $channelCode,
                'response' => $body,
            ]);
            throw new PaymentGatewayException(
                'Failed to link this payment method.',
                is_array($body) ? ($body['message'] ?? null) : null,
                is_array($body) ? ($body['error_code'] ?? null) : null,
            );
        }

        return $response->json();
    }

    /**
     * Confirm a still-`pending` linked method against Xendit and advance it.
     *
     * Linking otherwise activates ONLY via the `payment_method.activated`
     * webhook — so if that webhook is delayed, dropped, or (in test mode) never
     * configured for the active key's mode, the method the customer just
     * authorized sits `pending` forever and "linking doesn't work". This pulls
     * the method's REAL status directly from the gateway, exactly as
     * reconcileBookingPayment() does for charges, so linking completes without
     * depending on webhook delivery.
     *
     * Safe to call on every payment-methods list read:
     *   • no-op unless the method is `pending` with a gateway ref;
     *   • a gateway hiccup never throws — it just stays pending, retries later;
     *   • throttled per method so frequent list refetches don't hammer Xendit;
     *   • only ever moves the method to the state the gateway itself reports.
     */
    public function reconcileLinkedMethod(PaymentMethod $method): PaymentMethod
    {
        if ($method->status !== 'pending' || blank($method->gateway_ref) || blank($this->secretKey)) {
            return $method;
        }

        // Rate-limit the gateway pull per method (the app refetches the list on
        // return, and pull-to-refresh can fire it repeatedly while pending).
        if (! Cache::add("payment_method_reconcile_pull:{$method->id}", 1, self::RECONCILE_PULL_THROTTLE_SECONDS)) {
            return $method;
        }

        try {
            $response = $this->http()->get("{$this->baseUrl}/v2/payment_methods/{$method->gateway_ref}");
            if (! $response->successful()) {
                return $method;
            }
            $gatewayStatus = strtoupper((string) ($response->json('status') ?? ''));
        } catch (\Throwable $e) {
            return $method; // gateway unreachable/transient — never fail the read
        }

        $local = match ($gatewayStatus) {
            'ACTIVE' => 'active',
            'EXPIRED' => 'expired',
            'FAILED', 'INACTIVE' => 'failed',
            default => null, // PENDING / REQUIRES_ACTION — customer hasn't finished
        };

        if ($local === null || $local === $method->status) {
            return $method;
        }

        $method->status = $local;
        if ($local === 'active') {
            // Parity with link(): the first active method becomes the default.
            $method->is_default = ! PaymentMethod::where('user_id', $method->user_id)
                ->where('status', 'active')
                ->where('id', '!=', $method->id)
                ->exists();
        }
        $method->save();

        return $method;
    }

    /**
     * Charge a previously-linked payment method by its Xendit id — no redirect
     * for MULTIPLE_USE tokens. Returns the payment_request object; a first-time
     * charge may come back REQUIRES_ACTION with an auth URL in `actions`.
     */
    public function chargeSavedMethod(string $xenditPaymentMethodId, float $amount, string $referenceId, string $description = ''): array
    {
        $response = $this->http("pr-{$referenceId}")
            ->post("{$this->baseUrl}/payment_requests", [
                'reference_id' => $referenceId,
                'currency' => 'PHP',
                'amount' => round($amount, 2),
                'payment_method_id' => $xenditPaymentMethodId,
                'description' => $description,
            ]);

        if (! $response->successful()) {
            $body = $response->json();
            Log::error('Xendit: Failed to charge saved method', [
                'status' => $response->status(),
                'response' => $body,
            ]);
            throw new PaymentGatewayException(
                'Failed to charge your saved payment method.',
                is_array($body) ? ($body['message'] ?? null) : null,
                is_array($body) ? ($body['error_code'] ?? null) : null,
            );
        }

        return $response->json();
    }

    /**
     * Pull the customer-facing authorization URL out of a Xendit payment-method
     * or payment-request `actions` array (the link/authorize step).
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
     * Send a runner payout to their bank / e-wallet via Xendit Payouts (v2).
     *
     * Money-safe: the wallet is already debited when the payout row is created
     * (runner request or admin-initiated), so we do NOT mark it completed here.
     * We store the Xendit payout id and let the payout.succeeded /
     * payout.failed webhook settle it (a failure re-credits the wallet).
     * Idempotency-key = po-{tx} so a retry collapses to the same Xendit payout
     * instead of double-sending real money.
     *
     * @throws \RuntimeException on a gateway rejection.
     */
    public function createPayout(string $walletTxId, string $channelCode, string $accountNumber, string $accountHolderName): array
    {
        $tx = \App\Models\WalletTransaction::where('type', 'payout')->findOrFail($walletTxId);

        if ($tx->status !== 'pending') {
            throw new \RuntimeException('Only a pending payout can be sent.');
        }

        if (blank($this->secretKey)) {
            throw new \RuntimeException('Xendit is not configured (XENDIT_SECRET_KEY empty).');
        }

        $amount = abs((float) $tx->amount);

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
                'description' => 'ErrandGuy runner payout',
            ]);

        if (! $response->successful()) {
            Log::error('Xendit: payout request failed', [
                'wallet_tx' => $tx->id,
                'response' => $response->json(),
            ]);
            throw new \RuntimeException(
                $response->json('message') ?? 'Failed to send payout via Xendit.'
            );
        }

        $data = $response->json();

        // Record the gateway payout id so the webhook can settle this row; it
        // stays 'pending' until payout.succeeded / payout.failed arrives.
        $tx->update(['gateway_ref' => $data['id'] ?? $tx->gateway_ref]);

        return $data;
    }

    /**
     * Issue a REAL, FULL gateway reversal to source via Xendit.
     *
     * Locked + status-guarded: the payment row is locked for the duration so
     * concurrent refunds of the same payment serialize, and a second attempt
     * no-ops once it is Refunded (this closes the over-refund window). Partial
     * refunds are intentionally NOT supported here — they require the P2 refunds
     * ledger to stay reconcilable and to avoid the cancel-path double-refund;
     * full-only keeps the record and the cancel path unambiguous. Stamps
     * refunded_to='gateway' and syncs booking.payment_status.
     *
     * @throws \RuntimeException if the payment has no gateway charge or is not completed.
     */
    public function refundPayment(string $paymentId, ?float $amount = null, string $reason = 'REQUESTED_BY_CUSTOMER'): array
    {
        return DB::transaction(function () use ($paymentId, $reason) {
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
     */
    public function refundToWallet(string $paymentId, string $reason = 'REQUESTED_BY_CUSTOMER'): void
    {
        DB::transaction(function () use ($paymentId, $reason) {
            $payment = Payment::whereKey($paymentId)->lockForUpdate()->firstOrFail();

            if ($payment->method === 'cash') {
                throw new \RuntimeException('Cash is settled directly with the runner; there is nothing for the platform to refund.');
            }
            if ($payment->status !== PaymentStatus::Completed->value) {
                throw new \RuntimeException('Only a completed payment can be refunded to wallet.');
            }

            $amount = round((float) $payment->amount, 2);
            app(WalletService::class)->refund($payment->customer_id, $amount, $payment->id);

            $this->recordRefund($payment, 'wallet', $amount, $reason);
        });
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

    public function processBookingPayment(
        string $bookingId,
        string $customerId,
        float $amount,
        string $method,
        ?string $gatewayToken = null
    ): Payment {
        $payment = Payment::create([
            'booking_id' => $bookingId,
            'customer_id' => $customerId,
            'amount' => $amount,
            'currency' => 'PHP',
            'method' => $method,
            'status' => 'pending',
        ]);

        if ($method === 'cash') {
            return $payment;
        }

        if ($method === 'wallet') {
            app(WalletService::class)->deduct(
                $customerId,
                $amount,
                $payment->id,
                "Payment for booking {$bookingId}"
            );
            $payment->transitionTo(PaymentStatus::Completed, extra: ['paid_at' => now()]);
            return $payment;
        }

        try {
            $paymentRequest = $this->createPaymentRequest(
                $amount,
                "booking-{$bookingId}",
                $method,
                "Booking {$bookingId}"
            );

            $payment->transitionTo(PaymentStatus::Processing, extra: [
                'gateway_tx_id' => $paymentRequest['id'],
                'gateway_response' => $paymentRequest,
            ]);
        } catch (\Throwable $e) {
            Log::error('Payment processing failed', [
                'booking_id' => $bookingId,
                'error' => $e->getMessage(),
            ]);

            $payment->transitionTo(PaymentStatus::Failed, reason: 'Gateway charge failed');
        }

        return $payment;
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
    public function reconcileBookingPayment(Payment $payment): Payment
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
        if (! Cache::add("payment_reconcile_pull:{$payment->id}", 1, self::RECONCILE_PULL_THROTTLE_SECONDS)) {
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
            return DB::transaction(function () use ($payment, $pr, $gatewayStatus) {
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
                } else { // EXPIRED
                    $locked->transitionTo(PaymentStatus::Expired, 'reconcile', 'payment_request.expired', extra: [
                        'gateway_response' => $pr,
                    ]);
                }

                return $locked;
            });
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

    private function mapPaymentMethod(string $method): string
    {
        return match ($method) {
            'gcash', 'maya' => 'EWALLET',
            'card' => 'CARD',
            'grab_pay' => 'EWALLET',
            default => 'EWALLET',
        };
    }
}
