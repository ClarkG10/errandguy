<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Wallet-funded (instant) tips: a customer WITH balance tips their runner from
 * their withdrawable wallet, crediting the runner immediately. Guards against
 * this shipping broken again — the endpoint previously fatalled because
 * WalletService referenced Booking without importing it.
 */
class WalletTipTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 500,
        ]);
        $this->runner = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'wallet_balance' => 0,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeCompletedBooking(array $overrides = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-WT-'.strtoupper(substr(md5(microtime().random_int(0, 9999)), 0, 6)),
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id,
            'status' => 'completed',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'cash', 'payment_status' => 'paid',
            'is_transportation' => false, 'tip_amount' => 0,
        ], $overrides));
    }

    public function test_wallet_tip_moves_both_wallets_and_stamps_the_booking(): void
    {
        $booking = $this->makeCompletedBooking();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip", ['amount' => 50])
            ->assertOk()
            ->assertJsonPath('data.tip_amount', 50);

        $this->assertSame(450.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame(50.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(50.0, (float) $booking->fresh()->tip_amount);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'reference_id' => $booking->id, 'type' => 'tip', 'amount' => 50,
        ]);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'reference_id' => $booking->id, 'type' => 'tip', 'amount' => -50,
        ]);
    }

    public function test_wallet_tip_is_rejected_when_balance_is_insufficient(): void
    {
        $this->customer->update(['wallet_balance' => 10]);
        $booking = $this->makeCompletedBooking();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip", ['amount' => 50])
            ->assertStatus(422)
            ->assertJsonPath('code', 'INSUFFICIENT_WALLET_BALANCE');

        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $booking->fresh()->tip_amount);
    }

    public function test_an_errand_cannot_be_tipped_twice(): void
    {
        $booking = $this->makeCompletedBooking();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip", ['amount' => 50])
            ->assertOk();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip", ['amount' => 50])
            ->assertStatus(409)
            ->assertJsonPath('code', 'CONFLICT');

        // Only the first tip moved money.
        $this->assertSame(450.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame(50.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_cannot_tip_an_errand_that_had_no_runner(): void
    {
        $booking = $this->makeCompletedBooking(['runner_id' => null]);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip", ['amount' => 50])
            ->assertStatus(422)
            ->assertJsonPath('code', 'BOOKING_STATE_INVALID');
    }
}
