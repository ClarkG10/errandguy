<?php

namespace Tests\Feature\Audit;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Regression guards for the sweep-4 fixes: the idle-runner active-booking cache
 * (a null result used to never be cached) and busting that cache on cancel.
 */
class DiscoverySweep4Test extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        // The location push fans out to Supabase over HTTP — stub it.
        Http::fake(['*' => Http::response('', 201)]);
    }

    private function errandType(): ErrandType
    {
        return ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    public function test_idle_runner_location_ping_caches_the_no_active_booking_sentinel(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'current_lat' => 14.60, 'current_lng' => 120.98, 'preferred_types' => [],
        ]);

        $this->actingAs($runner)
            ->postJson('/api/v1/runner/location', ['lat' => 14.60, 'lng' => 120.98])
            ->assertOk();

        // The idle case (no active booking) is now actually stored — previously
        // Cache::remember discarded the null and re-queried on every ping.
        $this->assertTrue(Cache::has("runner_active_booking_id:{$runner->id}"));
        $this->assertSame('', Cache::get("runner_active_booking_id:{$runner->id}"));
    }

    public function test_cancelling_a_matched_booking_busts_the_runner_active_booking_cache(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = Booking::create([
            'booking_number' => 'EG-20260331-BUST', 'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $this->errandType()->id, 'status' => 'matched',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'cash', 'payment_status' => 'unpaid', 'is_transportation' => false,
        ]);

        // Prime the per-runner active-booking cache (as a location ping would).
        Cache::put("runner_active_booking_id:{$runner->id}", $booking->id, 30);

        $this->actingAs($customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'Changed my mind'])
            ->assertOk();

        // Cache is busted, so the runner's next GPS ping won't stay tagged to
        // the cancelled booking.
        $this->assertFalse(Cache::has("runner_active_booking_id:{$runner->id}"));
    }
}
