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
        $this->baseUrl = 'https://api.paymongo.com/v1';
        $this->secretKey = config('services.paymongo.secret_key');
    }

    public function createPaymentIntent(float $amount, string $description = ''): array
    {
        $response = Http::withBasicAuth($this->secretKey, '')
            ->post("{$this->baseUrl}/payment_intents", [
                'data' => [
                    'attributes' => [
                        'amount' => (int) round($amount * 100),
                        'payment_method_allowed' => ['card', 'gcash', 'grab_pay', 'paymaya'],
                        'currency' => 'PHP',
                        'description' => $description,
                        'statement_descriptor' => 'ErrandGuy',
                    ],
                ],
            ]);

        if (!$response->successful()) {
            Log::error('PayMongo: Failed to create payment intent', [
                'response' => $response->json(),
            ]);
            throw new \RuntimeException('Failed to create payment intent.');
        }

        return $response->json('data');
    }

    public function attachPaymentIntent(string $paymentIntentId, string $paymentMethodId, string $returnUrl): array
    {
        $response = Http::withBasicAuth($this->secretKey, '')
            ->post("{$this->baseUrl}/payment_intents/{$paymentIntentId}/attach", [
                'data' => [
                    'attributes' => [
                        'payment_method' => $paymentMethodId,
                        'return_url' => $returnUrl,
                    ],
                ],
            ]);

        if (!$response->successful()) {
            Log::error('PayMongo: Failed to attach payment intent', [
                'response' => $response->json(),
            ]);
            throw new \RuntimeException('Failed to attach payment intent.');
        }

        return $response->json('data');
    }

    public function createPaymentMethod(string $type, array $details = [], array $billing = []): array
    {
        $attributes = ['type' => $type];

        if (!empty($details)) {
            $attributes['details'] = $details;
        }

        if (!empty($billing)) {
            $attributes['billing'] = $billing;
        }

        $response = Http::withBasicAuth($this->secretKey, '')
            ->post("{$this->baseUrl}/payment_methods", [
                'data' => [
                    'attributes' => $attributes,
                ],
            ]);

        if (!$response->successful()) {
            Log::error('PayMongo: Failed to create payment method', [
                'response' => $response->json(),
            ]);
            throw new \RuntimeException('Failed to create payment method.');
        }

        return $response->json('data');
    }

    public function createSource(float $amount, string $type, string $redirectSuccess, string $redirectFailed): array
    {
        $response = Http::withBasicAuth($this->secretKey, '')
            ->post("{$this->baseUrl}/sources", [
                'data' => [
                    'attributes' => [
                        'amount' => (int) round($amount * 100),
                        'currency' => 'PHP',
                        'type' => $type,
                        'redirect' => [
                            'success' => $redirectSuccess,
                            'failed' => $redirectFailed,
                        ],
                    ],
                ],
            ]);

        if (!$response->successful()) {
            Log::error('PayMongo: Failed to create source', [
                'response' => $response->json(),
            ]);
            throw new \RuntimeException('Failed to create payment source.');
        }

        return $response->json('data');
    }

    public function refundPayment(string $paymentId, ?float $amount = null, string $reason = 'requested_by_customer'): array
    {
        $payment = Payment::findOrFail($paymentId);

        $refundAmount = $amount ?? (float) $payment->amount;

        $response = Http::withBasicAuth($this->secretKey, '')
            ->post("{$this->baseUrl}/refunds", [
                'data' => [
                    'attributes' => [
                        'amount' => (int) round($refundAmount * 100),
                        'payment_id' => $payment->gateway_tx_id,
                        'reason' => $reason,
                    ],
                ],
            ]);

        if (!$response->successful()) {
            Log::error('PayMongo: Failed to process refund', [
                'response' => $response->json(),
            ]);
            throw new \RuntimeException('Failed to process refund.');
        }

        $payment->update([
            'refund_amount' => $refundAmount,
            'refunded_at' => now(),
            'status' => 'refunded',
        ]);

        return $response->json('data');
    }

    public function retrievePaymentIntent(string $paymentIntentId): array
    {
        $response = Http::withBasicAuth($this->secretKey, '')
            ->get("{$this->baseUrl}/payment_intents/{$paymentIntentId}");

        if (!$response->successful()) {
            throw new \RuntimeException('Failed to retrieve payment intent.');
        }

        return $response->json('data');
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
            $intent = $this->createPaymentIntent($amount, "Booking {$bookingId}");

            $payment->update([
                'gateway_tx_id' => $intent['id'],
                'gateway_response' => $intent,
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
}
