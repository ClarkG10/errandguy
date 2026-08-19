<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Wallet-funded tipping moves real money (customer debit + runner credit) and
 * had NO regression coverage. Locks: the happy path moves both wallets exactly
 * once; a repeat tip is refused with no double-debit; a non-completed or
 * someone-else's errand can't be tipped; an insufficient balance is refused with
 * no partial movement; and the service-layer idempotency guard holds even if the
 * controller's tip_amount check is bypassed (the concurrent-request case).
 */
class TipTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake(); // tip() dispatches a runner push we don't exercise here

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 500]);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 100]);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-TIP1', 'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id, 'errand_type_id' => $errandType->id, 'status' => 'completed',
            'pickup_address' => 'a', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'b', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'payment_status' => 'paid',
            'is_transportation' => false,
        ]);
    }

    public function test_customer_can_tip_a_completed_errand_and_both_wallets_move_once(): void
    {
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/tip", ['amount' => 50])
            ->assertOk()
            ->assertJsonPath('data.tip_amount', 50);

        $this->assertEquals(450.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertEquals(150.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertEquals(50.0, (float) $this->booking->fresh()->tip_amount);

        // Exactly one debit + one credit, both tagged to this booking.
        $txns = WalletTransaction::where('reference_id', $this->booking->id)->where('type', 'tip')->get();
        $this->assertCount(2, $txns);
        $this->assertEqualsCanonicalizing([-50.0, 50.0], $txns->pluck('amount')->map(fn ($a) => (float) $a)->all());
    }

    public function test_a_second_tip_on_the_same_errand_is_refused_without_a_double_debit(): void
    {
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/tip", ['amount' => 50])->assertOk();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/tip", ['amount' => 50])
            ->assertJsonPath('code', 'CONFLICT');

        // Still only one debit — the customer was not charged twice.
        $this->assertEquals(450.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame(1, WalletTransaction::where('reference_id', $this->booking->id)
            ->where('user_id', $this->customer->id)->where('type', 'tip')->count());
    }

    public function test_cannot_tip_a_non_completed_errand(): void
    {
        $this->booking->update(['status' => 'accepted']);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/tip", ['amount' => 50])
            ->assertJsonPath('code', 'BOOKING_STATE_INVALID');

        $this->assertEquals(500.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_cannot_tip_another_customers_errand(): void
    {
        $stranger = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 500]);

        // Scoped by customer_id → the stranger's request 404s (not their booking).
        $this->actingAs($stranger)
            ->postJson("/api/v1/bookings/{$this->booking->id}/tip", ['amount' => 50])
            ->assertStatus(404);

        $this->assertEquals(0.0, (float) $this->booking->fresh()->tip_amount);
    }

    public function test_insufficient_balance_is_refused_with_no_partial_movement(): void
    {
        $this->customer->update(['wallet_balance' => 10]);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$this->booking->id}/tip", ['amount' => 50])
            ->assertJsonPath('code', 'INSUFFICIENT_WALLET_BALANCE');

        $this->assertEquals(10.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertEquals(100.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0, WalletTransaction::where('reference_id', $this->booking->id)->count());
    }

    public function test_wallet_service_tip_is_idempotent_at_the_service_layer(): void
    {
        // Bypasses the controller's tip_amount short-circuit to prove the service
        // itself refuses a second credit (the concurrent-request guard): the
        // locked exists() check + the uq_wallet_tx_user_reference_type index.
        $svc = app(WalletService::class);
        $svc->tip($this->booking->id, $this->customer->id, $this->runner->id, 50);

        $this->expectException(\RuntimeException::class);
        try {
            $svc->tip($this->booking->id, $this->customer->id, $this->runner->id, 50);
        } finally {
            // Still exactly one debit regardless of the throw.
            $this->assertEquals(450.0, (float) $this->customer->fresh()->wallet_balance);
            $this->assertSame(1, WalletTransaction::where('reference_id', $this->booking->id)
                ->where('user_id', $this->customer->id)->where('type', 'tip')->count());
        }
    }
}
