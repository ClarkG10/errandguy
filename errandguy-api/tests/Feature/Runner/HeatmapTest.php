<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HeatmapTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();

        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
        ]);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        // Two bookings share a geo cell (rounded to 3dp) → weight 2;
        // a third sits in a different cell → weight 1.
        $this->makeBooking($customer->id, 14.6001, 120.9801);
        $this->makeBooking($customer->id, 14.6002, 120.9802);
        $this->makeBooking($customer->id, 14.7000, 121.0500);
    }

    public function test_heatmap_returns_weighted_cells(): void
    {
        $response = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/heatmap?days=14');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'days',
                    'cells' => [['lat', 'lng', 'weight']],
                ],
            ]);

        $cells = collect($response->json('data.cells'));
        // Three bookings collapse into two cells.
        $this->assertCount(2, $cells);
        $this->assertEquals(3, $cells->sum('weight'));
        $this->assertEquals(2, $cells->max('weight'));
    }

    public function test_peak_hours_returns_dow_hour_grid(): void
    {
        $response = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/peak-hours?days=30');

        $response->assertOk()
            ->assertJsonPath('data.days', 30);

        $grid = $response->json('data.grid');
        $this->assertCount(7, $grid);
        foreach ($grid as $row) {
            $this->assertCount(24, $row);
        }

        // Every booking created "now" lands in exactly one dow/hour cell,
        // so the grid must sum to the number of seeded bookings.
        $total = collect($grid)->flatten()->sum();
        $this->assertEquals(3, $total);
    }

    public function test_customer_cannot_access_heatmap(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($customer)
            ->getJson('/api/v1/runner/heatmap')
            ->assertStatus(403);

        $this->actingAs($customer)
            ->getJson('/api/v1/runner/peak-hours')
            ->assertStatus(403);
    }

    private function makeBooking(string $customerId, float $lat, float $lng): void
    {
        Booking::create([
            'booking_number' => 'EG-HEAT-' . substr(md5($lat . $lng . microtime()), 0, 8),
            'customer_id' => $customerId,
            'errand_type_id' => $this->errandType->id,
            'status' => 'pending',
            'pickup_address' => 'X', 'pickup_lat' => $lat, 'pickup_lng' => $lng,
            'dropoff_address' => 'Y', 'dropoff_lat' => $lat, 'dropoff_lng' => $lng,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 1.0, 'base_fee' => 50, 'distance_fee' => 10, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 75, 'runner_payout' => 60,
            'is_transportation' => false,
        ]);
    }
}
