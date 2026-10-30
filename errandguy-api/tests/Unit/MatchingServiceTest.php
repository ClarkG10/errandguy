<?php

namespace Tests\Unit;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\MatchingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MatchingServiceTest extends TestCase
{
    use RefreshDatabase;

    private MatchingService $service;
    private ErrandType $errandType;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->service = app(MatchingService::class);

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260331-MTCH',
            'customer_id' => $customer->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'pending',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }

    public function test_returns_null_when_no_runners_available(): void
    {
        $result = $this->service->findRunner($this->booking->id);
        $this->assertNull($result);
    }

    public function test_finds_nearby_online_approved_runner(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.6000,
            'current_lng' => 120.9850,
            'preferred_types' => [],
        ]);

        $result = $this->service->findRunner($this->booking->id);
        $this->assertNotNull($result);
        $this->assertEquals($runner->id, $result->user_id);
    }

    public function test_does_not_find_offline_runner(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved',
            'is_online' => false,
            'current_lat' => 14.6000,
            'current_lng' => 120.9850,
            'preferred_types' => [],
        ]);

        $result = $this->service->findRunner($this->booking->id);
        $this->assertNull($result);
    }

    public function test_does_not_find_unapproved_runner(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'pending',
            'is_online' => true,
            'current_lat' => 14.6000,
            'current_lng' => 120.9850,
            'preferred_types' => [],
        ]);

        $result = $this->service->findRunner($this->booking->id);
        $this->assertNull($result);
    }

    public function test_does_not_match_a_booking_to_its_own_customer(): void
    {
        // The booking's customer is ALSO an online, approved runner right at the
        // pickup (and in runner mode). They must never be matched to their own
        // errand (self-match).
        User::whereKey($this->booking->customer_id)->update(['role' => 'runner']);
        RunnerProfile::create([
            'user_id' => $this->booking->customer_id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved', 'is_online' => true,
            'current_lat' => 14.6000, 'current_lng' => 120.9850, 'preferred_types' => [],
        ]);

        $this->assertNull($this->service->findRunner($this->booking->id));
    }

    public function test_self_customer_runner_is_skipped_for_a_real_runner_even_if_closer(): void
    {
        // Customer-as-runner (in runner mode) sits closer than the real runner...
        User::whereKey($this->booking->customer_id)->update(['role' => 'runner']);
        RunnerProfile::create([
            'user_id' => $this->booking->customer_id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved', 'is_online' => true,
            'current_lat' => 14.5996, 'current_lng' => 120.9843, 'preferred_types' => [],
        ]);
        $other = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $other->id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved', 'is_online' => true,
            'current_lat' => 14.6000, 'current_lng' => 120.9850, 'preferred_types' => [],
        ]);

        // ...yet the real runner is chosen; the customer is excluded, not merely deprioritized.
        $result = $this->service->findRunner($this->booking->id);
        $this->assertNotNull($result);
        $this->assertEquals($other->id, $result->user_id);
    }

    public function test_does_not_find_runner_too_far_away(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 10.0000, // Very far away
            'current_lng' => 118.0000,
            'preferred_types' => [],
        ]);

        $result = $this->service->findRunner($this->booking->id);
        $this->assertNull($result);
    }

    public function test_prefers_nearest_runner(): void
    {
        $nearRunner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $nearRunner->id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.6000, // Very close
            'current_lng' => 120.9845,
            'preferred_types' => [],
            'acceptance_rate' => 90.00,
        ]);

        $farRunner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $farRunner->id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.6100, // Farther
            'current_lng' => 120.9900,
            'preferred_types' => [],
            'acceptance_rate' => 95.00,
        ]);

        $result = $this->service->findRunner($this->booking->id);
        $this->assertEquals($nearRunner->id, $result->user_id);
    }

    public function test_filters_runners_by_preferred_types(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
            'vehicle_type' => 'motorcycle',
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.6000,
            'current_lng' => 120.9850,
            'preferred_types' => ['some-other-id-that-doesnt-match'],
        ]);

        $result = $this->service->findRunner($this->booking->id);
        $this->assertNull($result);
    }

    /**
     * Runners' preferred types were remapped onto the four launch types, so an
     * errand of a retired type that was booked but not yet taken must be
     * matched against the type that replaced it — otherwise a scheduled food
     * run would find nobody. Rides have no successor and stay unmatched.
     */
    public function test_a_retired_type_is_matched_to_runners_of_the_type_that_replaced_it(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'vehicle_type' => 'motorcycle',
            'current_lat' => 14.6000, 'current_lng' => 120.9850,
            'preferred_types' => ['purchase'],
        ]);

        $retired = function (string $slug): Booking {
            $type = ErrandType::create([
                'slug' => $slug, 'name' => ucfirst($slug), 'description' => $slug,
                'icon_name' => 'X', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
                'is_active' => false, 'sort_order' => 9,
            ]);

            return tap($this->booking->replicate(), function (Booking $b) use ($type, $slug) {
                $b->booking_number = 'EG-20261030-'.strtoupper(substr(md5($slug), 0, 4));
                $b->errand_type_id = $type->id;
                $b->save();
            });
        };

        $food = $retired('food');
        $this->assertSame($runner->id, $this->service->findRunner($food->id)?->user_id);

        $ride = $retired('transportation');
        $this->assertNull($this->service->findRunner($ride->id));

        // …and the delivery booking from setUp is not this runner's type.
        $this->assertNull($this->service->findRunner($this->booking->id));
    }

    /** An online, approved runner on a motorcycle at the pickup, unless overridden. */
    private function runner(array $profile = [], array $user = []): User
    {
        $runner = User::factory()->create(array_merge(['role' => 'runner', 'status' => 'active'], $user));
        RunnerProfile::create(array_merge([
            'user_id' => $runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'vehicle_type' => 'motorcycle',
            'current_lat' => 14.6000,
            'current_lng' => 120.9850,
            'last_location_at' => now(),
            'preferred_types' => [],
        ], $profile));

        return $runner;
    }

    public function test_a_car_booking_is_only_offered_to_a_car(): void
    {
        // The nearer runners ride smaller vehicles; the customer paid the car
        // price, so only the car runner further out qualifies.
        $this->runner(['vehicle_type' => 'walk', 'current_lat' => 14.5996]);
        $this->runner(['vehicle_type' => 'bicycle', 'current_lat' => 14.5997]);
        $this->runner(['vehicle_type' => 'motorcycle', 'current_lat' => 14.5998]);
        $car = $this->runner(['vehicle_type' => 'car', 'current_lat' => 14.6100]);

        $this->booking->update(['vehicle_type_rate' => 'car']);

        $this->assertSame($car->id, $this->service->findRunner($this->booking->id)?->user_id);
    }

    public function test_a_bigger_vehicle_may_take_a_smaller_booking_but_not_the_reverse(): void
    {
        $walker = $this->runner(['vehicle_type' => 'walk', 'current_lat' => 14.5996]);
        $car = $this->runner(['vehicle_type' => 'car', 'current_lat' => 14.6100]);

        // Motorcycle fare: the nearer walker can't serve it, the car can.
        $this->assertSame($car->id, $this->service->findRunner($this->booking->id)?->user_id);

        // Walking fare: anyone can, so the nearest wins.
        $this->booking->update(['vehicle_type_rate' => 'walk']);
        $this->assertSame($walker->id, $this->service->findRunner($this->booking->id)?->user_id);
    }

    public function test_a_runner_with_no_vehicle_on_file_counts_as_walking(): void
    {
        $this->runner(['vehicle_type' => null]);

        $this->assertNull($this->service->findRunner($this->booking->id));

        $this->booking->update(['vehicle_type_rate' => 'walk']);
        $this->assertNotNull($this->service->findRunner($this->booking->id));
    }

    public function test_runners_this_errand_was_already_offered_to_are_skipped(): void
    {
        $declined = $this->runner(['current_lat' => 14.5996]);
        $ignored = $this->runner(['current_lat' => 14.5997]);
        $fresh = $this->runner(['current_lat' => 14.6100]);

        $this->booking->update(['offered_runner_ids' => [$declined->id, $ignored->id]]);

        $this->assertSame($fresh->id, $this->service->findRunner($this->booking->id)?->user_id);
    }

    public function test_a_suspended_runner_or_one_in_customer_mode_is_never_matched(): void
    {
        $this->runner(user: ['status' => 'suspended']);
        $this->runner(user: ['role' => 'customer']);

        $this->assertNull($this->service->findRunner($this->booking->id));
    }

    public function test_a_waiting_runner_whose_phone_locked_still_gets_offers_for_15_minutes(): void
    {
        $locked = $this->runner(['last_location_at' => now()->subMinutes(14)]);
        $this->assertSame($locked->id, $this->service->findRunner($this->booking->id)?->user_id);

        RunnerProfile::where('user_id', $locked->id)->update(['last_location_at' => now()->subMinutes(16)]);
        $this->assertNull($this->service->findRunner($this->booking->id));
    }

    public function test_the_runners_working_radius_does_not_limit_matching(): void
    {
        // ~5 km from the pickup — outside the runner's own 1 km "working area"
        // setting, inside the 10 km matching radius. Only the matching radius
        // counts.
        $far = $this->runner(['current_lat' => 14.6450, 'working_area_radius' => 1000]);

        $this->assertSame($far->id, $this->service->findRunner($this->booking->id)?->user_id);
    }
}
