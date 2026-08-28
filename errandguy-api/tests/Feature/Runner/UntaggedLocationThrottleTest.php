<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerLocation;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A runner streams GPS from the moment they go online, long before any errand.
 * Every one of those untagged pings used to insert a row into the platform's
 * busiest table, and nothing reads them — every consumer is booking-scoped,
 * and matching uses the denormalised position on runner_profiles instead.
 *
 * Untagged pings are throttled; booking-tagged pings keep the full cadence so
 * the customer's live pin stays smooth.
 */
class UntaggedLocationThrottleTest extends TestCase
{
    use RefreshDatabase;

    private function onlineRunner(): User
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved',
            'is_online' => true, 'preferred_types' => [],
        ]);
        Sanctum::actingAs($runner);

        return $runner;
    }

    /**
     * LocationService also holds a 5s per-runner ping dedupe, which would mask
     * what we're measuring. Clear it between pings so each test isolates the
     * untagged throttle — the booking-tagged test uses the same helper and
     * still records every ping, which is what proves the clearing works.
     */
    private function clearPingDedupe(User $runner): void
    {
        Cache::forget("runner_location_throttle:{$runner->id}");
    }

    public function test_an_idle_online_runner_does_not_write_a_row_per_ping(): void
    {
        $runner = $this->onlineRunner();

        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/runner/location', [
                'lat' => 14.60 + ($i / 1000), 'lng' => 120.98,
            ]);
            $this->clearPingDedupe($runner);
        }

        // Throttled to one row for the window, not one per ping.
        $this->assertSame(
            1,
            RunnerLocation::where('runner_id', $runner->id)->count(),
            'untagged pings should be throttled, not written per ping',
        );
    }

    public function test_a_booking_tagged_ping_is_always_written_so_the_pin_stays_smooth(): void
    {
        $runner = $this->onlineRunner();
        $customer = User::factory()->create(['role' => 'customer']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-U-'.uniqid(),
            'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $type->id, 'status' => 'in_transit',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        // Warm the untagged throttle first — a tagged ping must ignore it.
        Cache::put("runner_untagged_loc_throttle:{$runner->id}", true, 20);

        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/runner/location', [
                'lat' => 14.60 + ($i / 1000), 'lng' => 120.98, 'booking_id' => $booking->id,
            ]);
            $this->clearPingDedupe($runner);
        }

        $this->assertSame(
            3,
            RunnerLocation::where('runner_id', $runner->id)->whereNotNull('booking_id')->count(),
            'booking-tagged pings must never be throttled',
        );
    }
}
