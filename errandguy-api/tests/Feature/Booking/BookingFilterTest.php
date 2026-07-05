<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BookingFilterTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        foreach (['pending', 'in_transit', 'completed', 'cancelled', 'no_runner'] as $i => $status) {
            Booking::create([
                'booking_number' => 'EG-FILTER-' . $i,
                'customer_id' => $this->customer->id,
                'errand_type_id' => $this->type->id,
                'status' => $status,
                'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
                'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
                'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
                'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
                'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
            ]);
        }
    }

    private function countFor(string $query = ''): int
    {
        $res = $this->actingAs($this->customer)->getJson("/api/v1/bookings{$query}");
        $res->assertOk();
        return count($res->json('data'));
    }

    public function test_active_filter_returns_only_non_terminal(): void
    {
        // pending + in_transit
        $this->assertEquals(2, $this->countFor('?status=active'));
    }

    public function test_completed_filter(): void
    {
        $this->assertEquals(1, $this->countFor('?status=completed'));
    }

    public function test_cancelled_filter_includes_no_runner(): void
    {
        // cancelled + no_runner
        $this->assertEquals(2, $this->countFor('?status=cancelled'));
    }

    public function test_all_and_unfiltered_return_everything(): void
    {
        $this->assertEquals(5, $this->countFor('?status=all'));
        $this->assertEquals(5, $this->countFor(''));
    }

    public function test_exact_status_still_works(): void
    {
        $this->assertEquals(1, $this->countFor('?status=pending'));
    }
}
