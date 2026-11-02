<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The runner acceptance rate is gone: no column, nothing recalculated when a
 * runner declines, and matching ranks by distance alone. The profile still
 * sends a fixed 100 for the app build already on phones (which shows "0%"
 * under a warning bar without it) until the app update is out.
 */
class AcceptanceRateRetiredTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'vehicle_type' => 'motorcycle', 'preferred_types' => [], 'completion_rate' => 100,
            'total_errands' => 3, 'total_earnings' => 0,
        ]);
    }

    public function test_the_column_is_gone(): void
    {
        $this->assertFalse(Schema::hasColumn('runner_profiles', 'acceptance_rate'));
    }

    public function test_the_profile_sends_a_fixed_100_for_the_old_app_and_earnings_nothing(): void
    {
        $profile = $this->actingAs($this->runner)->getJson('/api/v1/runner/profile')->assertOk()->json('data');
        $this->assertSame(100, $profile['acceptance_rate']);
        $this->assertArrayHasKey('completion_rate', $profile);

        $earnings = $this->actingAs($this->runner)->getJson('/api/v1/runner/earnings')->assertOk()->json('data');
        $this->assertArrayNotHasKey('acceptance_rate', $earnings);

        $home = $this->actingAs($this->runner)->getJson('/api/v1/runner/home')->assertOk()->json('data');
        $this->assertSame(100, $home['profile']['acceptance_rate']);
    }

    public function test_declining_an_offer_still_works(): void
    {
        Bus::fake();
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-DECLINE-1', 'customer_id' => $customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id, 'status' => 'matched', 'matched_at' => now(), 'pickup_address' => 'A',
            'pickup_lat' => 14.6, 'pickup_lng' => 120.98, 'dropoff_address' => 'B', 'dropoff_lat' => 14.55,
            'dropoff_lng' => 121.02, 'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);

        $this->actingAs($this->runner)->postJson("/api/v1/runner/errand/{$booking->id}/decline")->assertOk();

        $this->assertSame('pending', $booking->fresh()->status);
        $this->assertSame(3, (int) $this->runner->runnerProfile->fresh()->total_errands);
    }
}
