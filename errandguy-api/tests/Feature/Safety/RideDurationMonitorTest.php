<?php

namespace Tests\Feature\Safety;

use App\Events\RideDurationAlert;
use App\Jobs\CheckRideDurationJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Guards the ride-duration safety monitor (Phase 1). Two subtle bugs made it a
 * silent no-op: Carbon 3's signed diffInMinutes made "elapsed" negative so the
 * threshold never tripped, and the event was constructed with a booking ID
 * where it expects a Booking (TypeError). Both are easy to reintroduce.
 */
class RideDurationMonitorTest extends TestCase
{
    use RefreshDatabase;

    private function makeRide(array $overrides = []): Booking
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $runner = User::factory()->create(['role' => 'runner']);
        $type = ErrandType::create([
            'slug' => 'transportation', 'name' => 'Ride', 'description' => 'Ride',
            'icon_name' => 'Car', 'base_fee' => 50, 'per_km_walk' => 0, 'per_km_bicycle' => 0,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create(array_merge([
            'booking_number' => 'EG-RIDE-'.uniqid(),
            'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $type->id, 'status' => 'in_transit',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => true, 'sos_triggered' => false,
        ], $overrides));
    }

    public function test_alert_fires_when_ride_far_exceeds_estimate(): void
    {
        Event::fake([RideDurationAlert::class]);
        // 5km ride ~ 15min estimate; threshold = 2x = 30min. 3h elapsed >> that.
        $this->makeRide(['picked_up_at' => now()->subHours(3)]);

        (new CheckRideDurationJob())->handle();

        Event::assertDispatched(RideDurationAlert::class, function (RideDurationAlert $e) {
            // Elapsed must be a positive whole-minute count (the Carbon-sign fix).
            return $e->elapsedMinutes > 30 && $e->booking instanceof Booking;
        });
    }

    public function test_alert_does_not_fire_for_a_fresh_ride(): void
    {
        Event::fake([RideDurationAlert::class]);
        $this->makeRide(['picked_up_at' => now()->subMinutes(2)]);

        (new CheckRideDurationJob())->handle();

        Event::assertNotDispatched(RideDurationAlert::class);
    }
}
