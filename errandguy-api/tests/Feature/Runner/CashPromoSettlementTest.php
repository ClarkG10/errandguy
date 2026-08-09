<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * MONEY-2 regression: on a CASH booking that used a promo, the platform's
 * commission (what the runner owes back) must be netted by the promo it
 * granted — service_fee − promo_discount — because a promo is a
 * platform-funded discount, not a runner-funded one. Charging the full
 * service_fee made the runner eat the promo and overstated their earnings.
 */
class CashPromoSettlementTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'preferred_types' => [], 'total_errands' => 0, 'total_earnings' => 0.00, 'completion_rate' => 100.00,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    /**
     * Internally-consistent fixture: subtotal 100, service_fee 15 → pre-promo
     * total 115 and runner_payout 100. A ₱10 promo makes the customer pay 105
     * in cash; the runner keeps 100 and owes the platform 105 − 100 = ₱5.
     */
    private function makeCashPromoBooking(float $serviceFee, float $promo, float $payout, float $total): Booking
    {
        return Booking::create([
            'booking_number' => 'EG-20260808-'.strtoupper(substr(md5($serviceFee.$promo.$total), 0, 4)),
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'accepted',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => $serviceFee,
            'surcharge' => 0, 'promo_discount' => $promo, 'total_amount' => $total, 'runner_payout' => $payout,
            'payment_method' => 'cash', 'payment_status' => 'unpaid', 'is_transportation' => false,
        ]);
    }

    private function completeBooking(Booking $booking): void
    {
        Event::fake();
        Storage::fake('public');
        foreach (['heading_to_pickup', 'arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered', 'completed'] as $status) {
            $data = ['status' => $status];
            if ($status === 'picked_up') $data['pickup_photo'] = UploadedFile::fake()->image('p.jpg');
            if ($status === 'delivered') $data['delivery_photo'] = UploadedFile::fake()->image('d.jpg');
            if ($status === 'completed') $data['signature'] = UploadedFile::fake()->image('s.png');
            $this->actingAs($this->runner)->postJson("/api/v1/runner/errand/{$booking->id}/status", $data);
        }
    }

    public function test_cash_promo_commission_is_netted_by_the_promo(): void
    {
        $booking = $this->makeCashPromoBooking(serviceFee: 15, promo: 10, payout: 100, total: 105);

        $this->completeBooking($booking);

        // Commission owed = service_fee − promo = 15 − 10 = 5 (NOT the full 15).
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'commission',
            'reference_id' => $booking->id, 'amount' => '-5.00',
        ]);
        $this->assertEquals('-5.00', $this->runner->fresh()->wallet_balance);
        // Runner net = collected 105 − commission 5 = 100 = runner_payout.
        $this->assertDatabaseHas('runner_profiles', [
            'user_id' => $this->runner->id, 'total_earnings' => '100.00',
        ]);
    }

    public function test_cash_without_promo_still_charges_full_service_fee(): void
    {
        // Backward-compat: promo_discount 0 → commission == full service_fee.
        $booking = $this->makeCashPromoBooking(serviceFee: 15, promo: 0, payout: 100, total: 115);

        $this->completeBooking($booking);

        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'commission',
            'reference_id' => $booking->id, 'amount' => '-15.00',
        ]);
        $this->assertEquals('-15.00', $this->runner->fresh()->wallet_balance);
    }

    public function test_cash_promo_exceeding_fee_credits_the_runner_the_difference(): void
    {
        // Promo 20 > service_fee 15 → commission −5 → the platform absorbed the
        // promo and the runner is CREDITED the ₱5 they collected short in cash.
        $booking = $this->makeCashPromoBooking(serviceFee: 15, promo: 20, payout: 100, total: 95);

        $this->completeBooking($booking);

        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'commission',
            'reference_id' => $booking->id, 'amount' => '5.00',
        ]);
        $this->assertEquals('5.00', $this->runner->fresh()->wallet_balance);
    }
}
