<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class BookingPaymentTest extends TestCase
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

    public function test_cash_booking_is_unpaid_with_pending_payment(): void
    {
        Bus::fake();
        $res = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'cash']);

        $res->assertCreated();
        $booking = Booking::firstOrFail();
        $this->assertEquals('cash', $booking->payment_method);
        $this->assertEquals('unpaid', $booking->payment_status);
        $this->assertDatabaseHas('payments', [
            'booking_id' => $booking->id, 'method' => 'cash', 'status' => 'pending',
        ]);
        Bus::assertDispatched(\App\Jobs\MatchRunnerJob::class);
    }

    public function test_wallet_booking_deducts_balance_and_marks_paid(): void
    {
        Bus::fake();
        $this->customer->update(['wallet_balance' => 5000]);

        $res = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'wallet']);

        $res->assertCreated();
        $booking = Booking::firstOrFail();
        $this->assertEquals('paid', $booking->payment_status);
        // Balance dropped by the fare.
        $this->assertEquals(5000 - (float) $booking->total_amount, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('payments', [
            'booking_id' => $booking->id, 'method' => 'wallet', 'status' => 'completed',
        ]);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'payment',
        ]);
    }

    public function test_wallet_booking_with_insufficient_balance_is_rejected(): void
    {
        Bus::fake();
        $this->customer->update(['wallet_balance' => 10]);

        $res = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'wallet']);

        $res->assertStatus(422);
        // No orphaned booking left behind.
        $this->assertDatabaseCount('bookings', 0);
        Bus::assertNotDispatched(\App\Jobs\MatchRunnerJob::class);
    }

    public function test_online_booking_creates_invoice_and_returns_checkout_url(): void
    {
        Bus::fake();
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_bk', 'invoice_url' => 'https://checkout.xendit.co/inv_bk',
            ], 200),
        ]);

        $res = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'gcash']);

        $res->assertCreated()
            ->assertJsonPath('checkout_url', 'https://checkout.xendit.co/inv_bk');
        $booking = Booking::firstOrFail();
        $this->assertEquals('pending', $booking->payment_status);
        $this->assertDatabaseHas('payments', [
            'booking_id' => $booking->id, 'method' => 'gcash', 'status' => 'processing', 'gateway_tx_id' => 'inv_bk',
        ]);
    }

    public function test_cancelling_a_paid_wallet_booking_refunds_the_wallet(): void
    {
        Bus::fake();
        $this->customer->update(['wallet_balance' => 5000]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'wallet'])
            ->assertCreated();
        $booking = Booking::firstOrFail();
        $fare = (float) $booking->total_amount;
        $this->assertEquals(5000 - $fare, (float) $this->customer->fresh()->wallet_balance);

        // Pending booking (no runner) → free cancellation → full refund.
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'Changed my mind'])
            ->assertOk();

        $this->assertEquals('refunded', $booking->fresh()->payment_status);
        $this->assertEquals(5000, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
        $this->assertDatabaseHas('payments', [
            'booking_id' => $booking->id, 'status' => 'refunded',
        ]);
    }

    public function test_cancelling_a_cash_booking_refunds_nothing(): void
    {
        Bus::fake();
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'cash'])
            ->assertCreated();
        $booking = Booking::firstOrFail();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'Changed my mind'])
            ->assertOk();

        // Cash collected nothing → stays unpaid, no refund transaction.
        $this->assertEquals('unpaid', $booking->fresh()->payment_status);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
    }

    public function test_cancelling_an_accepted_paid_booking_withholds_the_flat_fee(): void
    {
        Bus::fake();
        $this->customer->update(['wallet_balance' => 5000]);

        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'wallet'])
            ->assertCreated();
        $booking = Booking::firstOrFail();

        // A runner has accepted → cancelling now withholds the ₱20 flat
        // convenience fee (CancellationPolicy 'flat' tier); the rest is refunded.
        $booking->update(['status' => 'accepted']);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'Changed my mind'])
            ->assertOk();

        $booking->refresh();
        $this->assertEquals('refunded', $booking->payment_status);
        $this->assertEquals(20.0, (float) $booking->cancellation_fee);
        // Paid the full fare, refunded (fare − ₱20) → net −₱20 from the 5000 start,
        // regardless of the exact fare.
        $this->assertEquals(4980.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
    }

    public function test_invoice_paid_webhook_marks_booking_paid(): void
    {
        Bus::fake();
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_bk2', 'invoice_url' => 'https://checkout.xendit.co/inv_bk2',
            ], 200),
        ]);
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'maya'])
            ->assertCreated();
        $payment = Payment::firstOrFail();

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'invoice.paid',
            'data' => ['external_id' => "booking-{$payment->id}", 'id' => 'inv_bk2'],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertEquals('completed', $payment->fresh()->status);
        $this->assertEquals('paid', $payment->booking->fresh()->payment_status);
    }

    public function test_webhook_logs_critical_when_settled_amount_mismatches(): void
    {
        Bus::fake();
        Log::spy();
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_bk3', 'invoice_url' => 'https://checkout.xendit.co/inv_bk3',
            ], 200),
        ]);
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'maya'])
            ->assertCreated();
        $payment = Payment::firstOrFail();

        // Gateway reports a DIFFERENT amount than we expected to charge.
        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'invoice.paid',
            'data' => [
                'external_id' => "booking-{$payment->id}",
                'id' => 'inv_bk3',
                'amount' => (float) $payment->amount + 100,
            ],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        // Tripwire fires...
        Log::shouldHaveReceived('critical')
            ->withArgs(fn ($msg) => str_contains($msg, 'settlement amount mismatch'))
            ->once();
        // ...but the settlement flow is unchanged (log-only).
        $this->assertEquals('completed', $payment->fresh()->status);
    }
}
