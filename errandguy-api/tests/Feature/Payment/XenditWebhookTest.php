<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class XenditWebhookTest extends TestCase
{
    use RefreshDatabase;

    private Payment $payment;
    private Booking $booking;
    private string $webhookToken = 'xnd_test_callback_token_for_testing';

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.xendit.webhook_token' => $this->webhookToken]);

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
            'gateway_tx_id' => 'pr_test_123',
        ]);
    }

    private function postWebhook(array $payload, ?string $token = null): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/webhooks/xendit', $payload, [
            'x-callback-token' => $token ?? $this->webhookToken,
        ]);
    }

    public function test_payment_succeeded_webhook_updates_payment(): void
    {
        $payload = [
            'event' => 'payment.succeeded',
            'data' => [
                'id' => 'ddpy_test_456',
                'payment_request_id' => 'pr_test_123',
                'status' => 'SUCCEEDED',
                'amount' => 115.00,
            ],
        ];

        $response = $this->postWebhook($payload);

        $response->assertOk()
            ->assertJsonPath('status', 'ok');

        $this->payment->refresh();
        $this->assertEquals('completed', $this->payment->status);
        $this->assertNotNull($this->payment->paid_at);
    }

    public function test_payment_failed_webhook_updates_payment(): void
    {
        $payload = [
            'event' => 'payment.failed',
            'data' => [
                'id' => 'ddpy_test_456',
                'payment_request_id' => 'pr_test_123',
                'status' => 'FAILED',
            ],
        ];

        $response = $this->postWebhook($payload);

        $response->assertOk();

        $this->payment->refresh();
        $this->assertEquals('failed', $this->payment->status);
        // The linked booking's payment_status is reconciled too (was left
        // stranded before — payment=failed but booking still pending/unpaid).
        $this->assertEquals('failed', $this->booking->fresh()->payment_status);
    }

    public function test_payment_failed_cancels_a_live_online_booking_and_releases_the_runner(): void
    {
        // BL-1 dispatch-before-capture: the booking was matched to a runner while
        // the gateway charge was still pending. When the customer abandons the
        // charge, the failed webhook must cancel the errand so the runner isn't
        // left working an order that was never paid for.
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->booking->update(['status' => 'matched', 'runner_id' => $runner->id]);

        $this->postWebhook([
            'event' => 'payment.failed',
            'data' => ['id' => 'ddpy_x', 'payment_request_id' => 'pr_test_123', 'status' => 'FAILED'],
        ])->assertOk();

        $this->booking->refresh();
        $this->assertEquals('cancelled', $this->booking->status);
        $this->assertNotNull($this->booking->cancelled_at);
        $this->assertNotEmpty($this->booking->cancellation_reason);
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'cancelled',
        ]);
    }

    public function test_late_payment_failure_never_cancels_an_already_completed_errand(): void
    {
        // The runner completed the errand before the charge captured (settlement
        // back-fills the earning). A late payment.failed must NOT tear down the
        // finished errand — only a still-live, genuinely unpaid booking is cancelled.
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->booking->update(['status' => 'completed', 'runner_id' => $runner->id]);

        $this->postWebhook([
            'event' => 'payment.failed',
            'data' => ['id' => 'ddpy_x', 'payment_request_id' => 'pr_test_123', 'status' => 'FAILED'],
        ])->assertOk();

        $this->assertEquals('completed', $this->booking->fresh()->status);
    }

    public function test_unknown_payment_id_is_ignored(): void
    {
        $payload = [
            'event' => 'payment.succeeded',
            'data' => [
                'id' => 'ddpy_unknown_999',
                'payment_request_id' => 'pr_unknown_999',
                'status' => 'SUCCEEDED',
            ],
        ];

        $response = $this->postWebhook($payload);

        $response->assertOk();

        $this->payment->refresh();
        $this->assertEquals('pending', $this->payment->status);
    }

    public function test_invalid_token_rejected(): void
    {
        $payload = [
            'event' => 'payment.succeeded',
            'data' => [
                'id' => 'ddpy_test_456',
                'payment_request_id' => 'pr_test_123',
            ],
        ];

        $response = $this->postWebhook($payload, 'invalid_token');

        $response->assertStatus(400)
            ->assertJsonPath('error', 'Invalid token');
    }

    public function test_missing_token_header_rejected(): void
    {
        $response = $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payment.succeeded',
            'data' => [
                'id' => 'ddpy_test_456',
                'payment_request_id' => 'pr_test_123',
            ],
        ]);

        $response->assertStatus(400)
            ->assertJsonPath('error', 'Token verification required');
    }

    public function test_unhandled_event_type_returns_ok(): void
    {
        $payload = [
            'event' => 'some.unknown.event',
            'data' => ['id' => 'xyz_123'],
        ];

        $response = $this->postWebhook($payload);
        $response->assertOk();
    }

    public function test_refund_amount_is_clamped_to_the_charge(): void
    {
        $this->payment->update(['status' => 'completed', 'paid_at' => now()->subHour()]);

        // A refund event declaring an amount larger than the ₱115 charge must
        // not persist that inflated figure (it would corrupt the refunded-total
        // reporting stat + the audit row). It is clamped to the charge.
        $payload = [
            'event' => 'refund.succeeded',
            'data' => [
                'reference_id' => 'refund-' . $this->payment->id,
                'amount' => 999999,
            ],
        ];

        $this->postWebhook($payload)->assertOk();

        $this->payment->refresh();
        $this->assertEquals('refunded', $this->payment->status);
        $this->assertEquals(115.00, (float) $this->payment->refund_amount);
    }

    public function test_idempotent_payment_succeeded_skips_already_completed(): void
    {
        $this->payment->update(['status' => 'completed', 'paid_at' => now()->subHour()]);
        $originalPaidAt = $this->payment->fresh()->paid_at;

        $payload = [
            'event' => 'payment.succeeded',
            'data' => [
                'id' => 'ddpy_test_456',
                'payment_request_id' => 'pr_test_123',
                'status' => 'SUCCEEDED',
            ],
        ];

        $response = $this->postWebhook($payload);
        $response->assertOk();

        $this->payment->refresh();
        $this->assertEquals('completed', $this->payment->status);
        $this->assertEquals($originalPaidAt->toDateTimeString(), $this->payment->paid_at->toDateTimeString());
    }
}
