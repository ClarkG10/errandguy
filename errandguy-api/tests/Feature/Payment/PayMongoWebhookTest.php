<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PayMongoWebhookTest extends TestCase
{
    use RefreshDatabase;

    private Payment $payment;
    private Booking $booking;
    private string $webhookSecret = 'whsec_test_secret_key_for_testing';

    protected function setUp(): void
    {
        parent::setUp();

        // Set webhook secret in config for test environment
        config(['services.paymongo.webhook_secret' => $this->webhookSecret]);

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-HOOK',
            'customer_id' => $customer->id,
            'errand_type_id' => $errandType->id,
            'status' => 'pending',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        $this->payment = Payment::create([
            'booking_id' => $this->booking->id,
            'customer_id' => $customer->id,
            'amount' => 115.00,
            'currency' => 'PHP',
            'method' => 'gcash',
            'status' => 'pending',
            'gateway_tx_id' => 'pay_test_123',
        ]);
    }

    /**
     * Generate a valid PayMongo webhook signature header for a given payload.
     */
    private function generateSignatureHeader(array $payload): string
    {
        $timestamp = time();
        $signedPayload = "{$timestamp}." . json_encode($payload);
        $signature = hash_hmac('sha256', $signedPayload, $this->webhookSecret);

        return "t={$timestamp},te={$signature}";
    }

    /**
     * Send a signed webhook POST request.
     */
    private function postSignedWebhook(array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/webhooks/paymongo', $payload, [
            'Paymongo-Signature' => $this->generateSignatureHeader($payload),
        ]);
    }

    public function test_payment_paid_webhook_updates_payment(): void
    {
        $payload = [
            'data' => [
                'attributes' => [
                    'type' => 'payment.paid',
                    'data' => [
                        'id' => 'pay_test_123',
                        'attributes' => ['status' => 'paid'],
                    ],
                ],
            ],
        ];

        $response = $this->postSignedWebhook($payload);

        $response->assertOk()
            ->assertJsonPath('status', 'ok');

        $this->payment->refresh();
        $this->assertEquals('completed', $this->payment->status);
        $this->assertNotNull($this->payment->paid_at);
    }

    public function test_payment_failed_webhook_updates_payment(): void
    {
        $payload = [
            'data' => [
                'attributes' => [
                    'type' => 'payment.failed',
                    'data' => [
                        'id' => 'pay_test_123',
                        'attributes' => ['status' => 'failed'],
                    ],
                ],
            ],
        ];

        $response = $this->postSignedWebhook($payload);

        $response->assertOk();

        $this->payment->refresh();
        $this->assertEquals('failed', $this->payment->status);
    }

    public function test_unknown_payment_id_is_ignored(): void
    {
        $payload = [
            'data' => [
                'attributes' => [
                    'type' => 'payment.paid',
                    'data' => [
                        'id' => 'pay_unknown_999',
                        'attributes' => ['status' => 'paid'],
                    ],
                ],
            ],
        ];

        $response = $this->postSignedWebhook($payload);

        $response->assertOk();

        $this->payment->refresh();
        $this->assertEquals('pending', $this->payment->status);
    }

    public function test_invalid_signature_rejected(): void
    {
        $payload = [
            'data' => ['attributes' => ['type' => 'payment.paid', 'data' => ['id' => 'pay_test_123']]],
        ];

        // Send with wrong signature
        $response = $this->postJson('/api/v1/webhooks/paymongo', $payload, [
            'Paymongo-Signature' => 't=12345,te=invalidsignature',
        ]);

        $response->assertStatus(400)
            ->assertJsonPath('error', 'Invalid signature');
    }

    public function test_missing_signature_header_rejected(): void
    {
        $response = $this->postJson('/api/v1/webhooks/paymongo', [
            'data' => ['attributes' => []],
        ]);

        $response->assertStatus(400)
            ->assertJsonPath('error', 'Signature verification required');
    }

    public function test_unhandled_event_type_returns_ok(): void
    {
        $payload = [
            'data' => [
                'attributes' => [
                    'type' => 'checkout.session.completed',
                    'data' => ['id' => 'cs_123'],
                ],
            ],
        ];

        $response = $this->postSignedWebhook($payload);
        $response->assertOk();
    }

    public function test_idempotent_payment_paid_skips_already_completed(): void
    {
        // Pre-set payment as completed
        $this->payment->update(['status' => 'completed', 'paid_at' => now()->subHour()]);
        $originalPaidAt = $this->payment->fresh()->paid_at;

        $payload = [
            'data' => [
                'attributes' => [
                    'type' => 'payment.paid',
                    'data' => [
                        'id' => 'pay_test_123',
                        'attributes' => ['status' => 'paid'],
                    ],
                ],
            ],
        ];

        $response = $this->postSignedWebhook($payload);
        $response->assertOk();

        // paid_at should NOT change (idempotency)
        $this->payment->refresh();
        $this->assertEquals('completed', $this->payment->status);
        $this->assertEquals($originalPaidAt->toDateTimeString(), $this->payment->paid_at->toDateTimeString());
    }
}
