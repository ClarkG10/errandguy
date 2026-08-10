<?php

namespace Tests\Feature\Payment;

use App\Enums\PaymentStatus;
use App\Exceptions\InvalidStatusTransitionException;
use App\Jobs\SendPushJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\IdempotencyKey;
use App\Models\Payment;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PaymentSafetyFoundationTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $deliveryType;
    private array $base;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        config(['services.xendit.secret_key' => 'test-secret']);
        config(['services.xendit.webhook_token' => 'test-webhook-token']);

        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 0,
            'email' => 'cust@example.com',
        ]);

        $this->deliveryType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Send packages',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'surcharge' => 0.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->base = [
            'errand_type_id' => $this->deliveryType->id,
            'pickup_address' => '123 Main St, Manila', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave, Makati', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'description' => 'Pick up a package', 'schedule_type' => 'now',
            'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
        ];
    }

    // ── Idempotency middleware ──────────────────────────────────────────────

    public function test_replayed_idempotency_key_returns_stored_response_and_creates_one_booking(): void
    {
        Bus::fake();
        $headers = ['Idempotency-Key' => 'attempt-abc-123'];
        $payload = [...$this->base, 'payment_method' => 'cash'];

        $first = $this->actingAs($this->customer)->postJson('/api/v1/bookings', $payload, $headers);
        $second = $this->actingAs($this->customer)->postJson('/api/v1/bookings', $payload, $headers);

        $first->assertCreated();
        $second->assertCreated();
        // Same booking returned both times, and only ONE actually created.
        $this->assertEquals($first->json('data.id'), $second->json('data.id'));
        $this->assertDatabaseCount('bookings', 1);
    }

    public function test_same_key_with_different_body_is_rejected(): void
    {
        Bus::fake();
        $headers = ['Idempotency-Key' => 'attempt-xyz-1'];

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'cash'], $headers)
            ->assertCreated();

        // Reusing the key for a DIFFERENT request must be refused.
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [
                ...$this->base, 'payment_method' => 'cash', 'dropoff_address' => 'Somewhere else entirely',
            ], $headers)
            ->assertStatus(422);
    }

    public function test_in_progress_idempotency_key_returns_409(): void
    {
        Bus::fake();
        // Simulate a first request still running by pre-claiming the key.
        IdempotencyKey::create([
            'user_id' => $this->customer->id,
            'idem_key' => 'inflight-1',
            'method' => 'POST',
            'path' => 'api/v1/bookings',
            'request_hash' => 'whatever',
            'status' => 'in_progress',
            'locked_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'cash'], ['Idempotency-Key' => 'inflight-1'])
            ->assertStatus(409);

        $this->assertDatabaseCount('bookings', 0);
    }

    public function test_missing_idempotency_key_still_works(): void
    {
        Bus::fake();
        // Phase 1: header is optional (soft pass-through).
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'cash'])
            ->assertCreated();
    }

    // ── payment_id in create response + status endpoint ─────────────────────

    public function test_booking_create_returns_payment_id_and_status_endpoint_reports_it(): void
    {
        Bus::fake();
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_status', 'invoice_url' => 'https://checkout.xendit.co/inv_status',
            ], 200),
        ]);

        $res = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'card'])
            ->assertCreated();

        $paymentId = $res->json('payment_id');
        $this->assertNotNull($paymentId);

        $status = $this->actingAs($this->customer)
            ->getJson("/api/v1/payments/{$paymentId}/status")
            ->assertOk();

        $status->assertJsonPath('data.status', 'processing')
            ->assertJsonPath('data.payment_id', $paymentId)
            ->assertJsonPath('data.method', 'card')
            ->assertJsonPath('data.reference', 'inv_status');
    }

    public function test_payment_status_is_ownership_scoped(): void
    {
        Bus::fake();
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response(['id' => 'inv_o', 'invoice_url' => 'https://x/inv_o'], 200),
        ]);
        $paymentId = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'card'])
            ->json('payment_id');

        $stranger = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->actingAs($stranger)
            ->getJson("/api/v1/payments/{$paymentId}/status")
            ->assertStatus(404);
    }

    // ── canonical status-probe contract ─────────────────────────────────────

    public function test_payment_status_probe_emits_canonical_contract(): void
    {
        Bus::fake();
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response(['id' => 'inv_c', 'invoice_url' => 'https://x/inv_c'], 200),
        ]);
        $paymentId = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'card'])
            ->json('payment_id');

        $this->actingAs($this->customer)
            ->getJson("/api/v1/payments/{$paymentId}/status")
            ->assertOk()
            // Canonical keys + kept aliases both present.
            ->assertJsonStructure(['data' => [
                'kind', 'id', 'payment_id', 'status', 'amount',
                'settled_at', 'paid_at', 'failure_reason',
            ]])
            ->assertJsonPath('data.kind', 'payment')
            ->assertJsonPath('data.id', $paymentId)
            ->assertJsonPath('data.payment_id', $paymentId);
    }

    public function test_booking_payment_status_is_pending_when_no_payment_row_yet(): void
    {
        // A booking that exists but has no Payment row must read as an honest
        // 200 'pending', not a 404 that a client can't tell from "unknown".
        $booking = Booking::create([
            'booking_number' => 'EG-20260331-NOPAY',
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->deliveryType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'gcash', 'payment_status' => 'pending',
            'is_transportation' => false,
        ]);

        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}/payment-status")
            ->assertOk()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.id', null)
            ->assertJsonPath('data.booking_id', $booking->id);
    }

    public function test_booking_payment_status_404_for_foreign_or_unknown_booking(): void
    {
        $stranger = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $booking = Booking::create([
            'booking_number' => 'EG-20260331-FOREIGN',
            'customer_id' => $stranger->id,
            'errand_type_id' => $this->deliveryType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'gcash', 'payment_status' => 'pending',
            'is_transportation' => false,
        ]);

        // Foreign booking → 404 (never leaked as pending).
        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}/payment-status")
            ->assertStatus(404);

        // Unknown booking → 404.
        $this->actingAs($this->customer)
            ->getJson('/api/v1/bookings/'.\Illuminate\Support\Str::uuid()->toString().'/payment-status')
            ->assertStatus(404);
    }

    // ── invoice.expired ─────────────────────────────────────────────────────

    public function test_invoice_expired_moves_booking_payment_to_expired_and_notifies(): void
    {
        Bus::fake();
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response(['id' => 'inv_exp', 'invoice_url' => 'https://x/inv_exp'], 200),
        ]);
        $payment = null;
        $paymentId = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'card'])
            ->json('payment_id');

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'invoice.expired',
            'data' => ['external_id' => "booking-{$paymentId}", 'id' => 'inv_exp'],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $payment = Payment::findOrFail($paymentId);
        $this->assertEquals('expired', $payment->status);
        $this->assertEquals('expired', $payment->booking->fresh()->payment_status);
        // The customer is notified via a queued SendPushJob — the webhook must
        // NOT send inline (a slow push would block the ACK to Xendit). Assert
        // the dispatch, since Bus::fake() intercepts the job here; the row it
        // would create is covered by NotificationService's own tests.
        Bus::assertDispatched(SendPushJob::class, function (SendPushJob $job) {
            return $job->userId === $this->customer->id
                && ($job->data['type'] ?? null) === 'payment'
                && ($job->data['status'] ?? null) === 'expired';
        });
        // Transition audited.
        $this->assertDatabaseHas('payment_status_transitions', [
            'payment_id' => $paymentId, 'to_status' => 'expired', 'actor' => 'webhook',
        ]);
    }

    public function test_invoice_expired_fails_pending_topup(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response(['id' => 'inv_tu', 'invoice_url' => 'https://x/inv_tu'], 200),
        ]);
        $this->actingAs($this->customer)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500])
            ->assertCreated();
        $tx = WalletTransaction::where('user_id', $this->customer->id)->firstOrFail();

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'invoice.expired',
            'data' => ['external_id' => "topup-{$tx->id}", 'id' => 'inv_tu'],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertEquals('failed', $tx->fresh()->status);
        // Balance never moved.
        $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);
    }

    // ── Webhook dedup + audit ───────────────────────────────────────────────

    public function test_webhook_records_event_and_writes_transition(): void
    {
        Bus::fake();
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response(['id' => 'inv_dedupe', 'invoice_url' => 'https://x/inv_dedupe'], 200),
        ]);
        $paymentId = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'card'])
            ->json('payment_id');

        $payload = [
            'event' => 'invoice.paid',
            'data' => ['external_id' => "booking-{$paymentId}", 'id' => 'inv_dedupe'],
        ];
        $headers = ['x-callback-token' => 'test-webhook-token'];

        $this->postJson('/api/v1/webhooks/xendit', $payload, $headers)->assertOk();
        // Redelivery is deduped.
        $this->postJson('/api/v1/webhooks/xendit', $payload, $headers)
            ->assertOk()
            ->assertJsonPath('deduped', true);

        $this->assertEquals('completed', Payment::findOrFail($paymentId)->status);
        $this->assertDatabaseHas('webhook_events', ['provider' => 'xendit', 'status' => 'processed']);
        // Exactly one completion transition despite two deliveries.
        $this->assertEquals(1, \App\Models\PaymentStatusTransition::where('payment_id', $paymentId)
            ->where('to_status', 'completed')->count());
    }

    // ── Transition guard (audit seed) ───────────────────────────────────────

    public function test_illegal_transition_throws(): void
    {
        $payment = Payment::create([
            'booking_id' => $this->makeBooking()->id,
            'customer_id' => $this->customer->id,
            'amount' => 100, 'currency' => 'PHP', 'method' => 'gcash',
            'status' => 'completed',
        ]);

        $this->expectException(InvalidStatusTransitionException::class);
        $payment->transitionTo(PaymentStatus::Processing);
    }

    public function test_legal_transition_writes_audit_row(): void
    {
        $payment = Payment::create([
            'booking_id' => $this->makeBooking()->id,
            'customer_id' => $this->customer->id,
            'amount' => 100, 'currency' => 'PHP', 'method' => 'gcash',
            'status' => 'pending',
        ]);

        $this->assertTrue($payment->transitionTo(PaymentStatus::Processing, 'system', 'test'));
        $this->assertEquals('processing', $payment->fresh()->status);
        $this->assertDatabaseHas('payment_status_transitions', [
            'payment_id' => $payment->id, 'from_status' => 'pending', 'to_status' => 'processing', 'reason' => 'test',
        ]);
        // Same-status move is an idempotent no-op (no new audit row).
        $this->assertFalse($payment->transitionTo(PaymentStatus::Processing));
        $this->assertEquals(1, \App\Models\PaymentStatusTransition::where('payment_id', $payment->id)->count());
    }

    private function makeBooking(): Booking
    {
        return Booking::create([
            'booking_number' => 'EG-TEST-' . substr(md5(uniqid('', true)), 0, 6),
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->deliveryType->id,
            'status' => 'pending',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }
}
