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
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
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
            'verification_status' => 'pending',
            'is_online' => true,
            'current_lat' => 14.6000,
            'current_lng' => 120.9850,
            'preferred_types' => [],
        ]);

        $result = $this->service->findRunner($this->booking->id);
        $this->assertNull($result);
    }

    public function test_does_not_find_runner_too_far_away(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
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

    public function test_broadcast_sets_negotiate_expiration(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.6000,
            'current_lng' => 120.9850,
            'preferred_types' => [],
        ]);

        $this->service->broadcastToRunners($this->booking->id);

        $this->booking->refresh();
        $this->assertNotNull($this->booking->negotiate_expires_at);
        $this->assertTrue($this->booking->negotiate_expires_at->isFuture());
    }

    public function test_filters_runners_by_preferred_types(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => 14.6000,
            'current_lng' => 120.9850,
            'preferred_types' => ['some-other-id-that-doesnt-match'],
        ]);

        $result = $this->service->findRunner($this->booking->id);
        $this->assertNull($result);
    }
}
