<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A tip credits the runner's wallet and stamps bookings.tip_amount, but the
 * earnings summary only ever summed runner_payout — so the runner got a push
 * saying a tip arrived, opened Earnings, and saw a total that silently
 * excluded it, reconcilable only by digging through the wallet ledger.
 *
 * Tips are reported as their OWN total. They must never be folded into
 * total_earnings: runner_payout is the figure the cash-settlement commission
 * maths and the PDF statement reconcile against.
 */
class EarningsTipsTest extends TestCase
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
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'preferred_types' => [], 'acceptance_rate' => 100.00, 'completion_rate' => 100.00,
            'total_errands' => 0, 'total_earnings' => 0.00,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function completedBooking(float $payout, float $tip = 0.0): Booking
    {
        return Booking::create([
            'booking_number' => 'EG-T-'.uniqid(),
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'completed',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 121.00,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => $payout,
            'tip_amount' => $tip,
            'is_transportation' => false, 'completed_at' => now(),
        ]);
    }

    public function test_summary_reports_tips_separately_from_earnings(): void
    {
        $this->completedBooking(100.0, 50.0);
        $this->completedBooking(80.0);

        Sanctum::actingAs($this->runner);
        $response = $this->getJson('/api/v1/runner/earnings?period=today')->assertOk();

        // Payout total is untouched by the tip.
        $this->assertSame(180.0, (float) $response->json('data.total_earnings'));
        $this->assertSame(50.0, (float) $response->json('data.total_tips'));
    }

    public function test_total_tips_is_zero_when_nobody_tipped(): void
    {
        $this->completedBooking(100.0);

        Sanctum::actingAs($this->runner);
        $this->getJson('/api/v1/runner/earnings?period=today')
            ->assertOk()
            ->assertJsonPath('data.total_tips', 0);
    }

    public function test_booking_payload_exposes_tip_amount_to_the_assigned_runner(): void
    {
        $booking = $this->completedBooking(100.0, 25.0);

        Sanctum::actingAs($this->runner);
        $this->getJson("/api/v1/runner/errand/{$booking->id}")
            ->assertOk()
            ->assertJsonPath('data.tip_amount', '25.00');
    }
}
