<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GET /runner/earnings/overview — today + this_week + this_month in one call (P9).
 */
class EarningsOverviewTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function completedBooking(string $number, $completedAt, float $payout = 85): Booking
    {
        return Booking::create([
            'booking_number' => $number,
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'completed',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => $payout,
            'is_transportation' => false, 'completed_at' => $completedAt,
        ]);
    }

    public function test_overview_requires_authentication(): void
    {
        $this->getJson('/api/v1/runner/earnings/overview')->assertUnauthorized();
    }

    public function test_overview_is_role_gated_to_runner(): void
    {
        $this->actingAs($this->customer)
            ->getJson('/api/v1/runner/earnings/overview')
            ->assertForbidden();
    }

    public function test_overview_returns_all_three_periods_and_excludes_out_of_range(): void
    {
        // Completed just now → inside today, this_week, and this_month.
        $this->completedBooking('EG-OVW-NOW', now(), 85);
        // Completed two months ago → inside NONE of the three current buckets.
        // (Date-boundary robust: never falls into today/this_week/this_month
        // regardless of which day the suite runs.)
        $this->completedBooking('EG-OVW-OLD', now()->subMonths(2), 999);

        $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings/overview')
            ->assertOk()
            ->assertJsonPath('data.today.total_earnings', 85)
            ->assertJsonPath('data.today.total_errands', 1)
            ->assertJsonPath('data.today.avg_per_errand', 85)
            ->assertJsonPath('data.this_week.total_earnings', 85)
            ->assertJsonPath('data.this_week.total_errands', 1)
            ->assertJsonPath('data.this_month.total_earnings', 85)
            ->assertJsonPath('data.this_month.total_errands', 1);
    }

    public function test_overview_zeroes_when_no_completed_bookings(): void
    {
        $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings/overview')
            ->assertOk()
            ->assertJsonPath('data.today.total_earnings', 0)
            ->assertJsonPath('data.today.total_errands', 0)
            ->assertJsonPath('data.today.avg_per_errand', 0)
            ->assertJsonPath('data.this_month.total_errands', 0);
    }
}
