<?php

namespace App\Services;

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
            Log::error('Xendit: Failed to create payment request', [
                'response' => $response->json(),
            ]);
            throw new \RuntimeException('Failed to create payment request.');
        }

        return $response->json();
    }

    public function createInvoice(float $amount, string $externalId, string $description = '', string $payerEmail = '', ?string $successRedirectUrl = null): array
    {
        $payload = [
            'external_id' => $externalId,
            'amount' => round($amount, 2),
            'currency' => 'PHP',
            'description' => $description,
            'payment_methods' => ['GCASH', 'PAYMAYA', 'CREDIT_CARD'],
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
            Log::error('Xendit: Failed to create invoice', [
                'response' => $response->json(),
            ]);
            throw new \RuntimeException('Failed to create invoice.');
        }

        return $response->json();
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
