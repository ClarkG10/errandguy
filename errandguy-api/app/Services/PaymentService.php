<?php

namespace App\Services;

use App\Exceptions\PaymentGatewayException;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PaymentService
{
    private string $baseUrl;
    private string $secretKey;

    public function __construct()
    {
        $this->baseUrl = 'https://api.xendit.co';
        $this->secretKey = config('services.xendit.secret_key');
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

        $response = Http::withBasicAuth($this->secretKey, '')
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

        $response = Http::withBasicAuth($this->secretKey, '')
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

        $response = Http::withBasicAuth($this->secretKey, '')
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

        $payload = [
            'type' => 'EWALLET',
            'reusability' => 'MULTIPLE_USE',
            'customer_id' => $customerId,
            'ewallet' => [
                'channel_code' => $channelCode,
                'channel_properties' => [
                    'success_return_url' => $successUrl,
                    'failure_return_url' => $failureUrl,
                ],
            ],
        ];

        $response = Http::withBasicAuth($this->secretKey, '')
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
     * Charge a previously-linked payment method by its Xendit id — no redirect
     * for MULTIPLE_USE tokens. Returns the payment_request object; a first-time
     * charge may come back REQUIRES_ACTION with an auth URL in `actions`.
     */
    public function chargeSavedMethod(string $xenditPaymentMethodId, float $amount, string $referenceId, string $description = ''): array
    {
        $response = Http::withBasicAuth($this->secretKey, '')
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

    public function refundPayment(string $paymentId, ?float $amount = null, string $reason = 'REQUESTED_BY_CUSTOMER'): array
    {
        $payment = Payment::findOrFail($paymentId);

        $refundAmount = $amount ?? (float) $payment->amount;

        $response = Http::withBasicAuth($this->secretKey, '')
            ->post("{$this->baseUrl}/refunds", [
                'payment_request_id' => $payment->gateway_tx_id,
                'amount' => round($refundAmount, 2),
                'currency' => 'PHP',
                'reason' => $reason,
                'reference_id' => "refund-{$payment->id}",
            ]);

        if (!$response->successful()) {
            Log::error('Xendit: Failed to process refund', [
                'response' => $response->json(),
            ]);
            throw new \RuntimeException('Failed to process refund.');
        }

        $payment->update([
            'refund_amount' => $refundAmount,
            'refunded_at' => now(),
            'status' => 'refunded',
        ]);

        return $response->json();
    }

    public function getPaymentRequest(string $paymentRequestId): array
    {
        $response = Http::withBasicAuth($this->secretKey, '')
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
            $payment->update([
                'status' => 'completed',
                'paid_at' => now(),
            ]);
            return $payment;
        }

        try {
            $paymentRequest = $this->createPaymentRequest(
                $amount,
                "booking-{$bookingId}",
                $method,
                "Booking {$bookingId}"
            );

            $payment->update([
                'gateway_tx_id' => $paymentRequest['id'],
                'gateway_response' => $paymentRequest,
                'status' => 'processing',
            ]);
        } catch (\Throwable $e) {
            Log::error('Payment processing failed', [
                'booking_id' => $bookingId,
                'error' => $e->getMessage(),
            ]);

            $payment->update(['status' => 'failed']);
        }

        return $payment;
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
