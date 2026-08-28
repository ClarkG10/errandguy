<?php

namespace Tests\Unit;

use App\Models\RunnerLocation;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\LocationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class LocationServiceTest extends TestCase
{
    use RefreshDatabase;

    private LocationService $service;
    private User $runner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(LocationService::class);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'current_lat' => null,
            'current_lng' => null,
            'preferred_types' => [],
        ]);
    }

    /**
     * A booking-tagged ping — the only kind whose history anything reads, and
     * the kind that feeds the customer's live pin.
     */
    private function trackedBookingId(): string
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $type = \App\Models\ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'D', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return \App\Models\Booking::create([
            'booking_number' => 'EG-LS-'.uniqid(),
            'customer_id' => $customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $type->id, 'status' => 'in_transit',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ])->id;
    }

    public function test_first_ping_records_history_and_denormalised_position(): void
    {
        $ok = $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.60, 'lng' => 120.98]);

        $this->assertTrue($ok);
        $this->assertSame(1, RunnerLocation::where('runner_id', $this->runner->id)->count());

        $profile = RunnerProfile::where('user_id', $this->runner->id)->first();
        $this->assertEquals(14.60, (float) $profile->current_lat);
        $this->assertNotNull($profile->last_location_at);
    }

    public function test_ingest_throttle_rejects_a_second_ping_within_5s(): void
    {
        $this->assertTrue(
            $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.60, 'lng' => 120.98])
        );
        // A second ping inside the 5s ingest window is rejected outright.
        $this->assertFalse(
            $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.61, 'lng' => 120.99])
        );
        $this->assertSame(1, RunnerLocation::where('runner_id', $this->runner->id)->count());
    }

    /**
     * A runner streams GPS from the moment they go online, long before any
     * errand, and every untagged ping used to insert a row into the busiest
     * table on the platform. Nothing reads those rows: every consumer is
     * booking-scoped, and matching uses runner_profiles instead.
     */
    public function test_untagged_pings_are_throttled_because_nothing_reads_them(): void
    {
        $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.60, 'lng' => 120.98]);
        Cache::forget("runner_location_throttle:{$this->runner->id}");
        $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.70, 'lng' => 121.10]);

        $this->assertSame(
            1,
            RunnerLocation::where('runner_id', $this->runner->id)->count(),
            'an idle online runner should not write a row per ping',
        );

        // The matching position still tracks the runner — that write has its
        // own throttle and is what matching actually reads.
        $profile = RunnerProfile::where('user_id', $this->runner->id)->first();
        $this->assertNotNull($profile->last_location_at);
    }

    public function test_profile_position_write_is_throttled_while_history_keeps_flowing(): void
    {
        // Booking-tagged, because that is the case whose history is actually
        // read (and the one feeding the customer's pin). Untagged pings are
        // deliberately throttled — see
        // test_untagged_pings_are_throttled_because_nothing_reads_them.
        $bookingId = $this->trackedBookingId();

        // Ping 1 — writes history + the denormalised matching position.
        $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.60, 'lng' => 120.98], $bookingId);

        // Next accepted ping a few seconds later: clear ONLY the 5s ingest gate,
        // leaving the longer profile-position gate in place (simulates real
        // 5s-cadence pings within the profile-throttle window).
        Cache::forget("runner_location_throttle:{$this->runner->id}");

        $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.70, 'lng' => 121.10], $bookingId);

        // History appended on both pings (keeps the customer's live pin smooth) …
        $this->assertSame(2, RunnerLocation::where('runner_id', $this->runner->id)->count());

        // … but the matching table's hot row was NOT rewritten on the 2nd ping —
        // still the 1st position (matching tolerates minutes of staleness).
        $profile = RunnerProfile::where('user_id', $this->runner->id)->first();
        $this->assertEquals(14.60, (float) $profile->current_lat);
        $this->assertEquals(120.98, (float) $profile->current_lng);
    }

    /**
     * created_at is guarded (not fillable) and timestamps are disabled on the
     * model, so set it directly — the explicit value is written on INSERT and
     * the useCurrent() column default only applies when no value is provided.
     */
    private function makeLocationAt(\DateTimeInterface $at): RunnerLocation
    {
        $loc = new RunnerLocation([
            'runner_id' => $this->runner->id,
            'lat' => 14.60,
            'lng' => 120.98,
        ]);
        $loc->created_at = $at;
        $loc->save();

        return $loc;
    }

    public function test_cleanup_deletes_locations_older_than_retention_and_keeps_recent(): void
    {
        $this->makeLocationAt(now()->subHours(25));
        $this->makeLocationAt(now()->subHours(48));
        $this->makeLocationAt(now()->subDays(3));
        $recentA = $this->makeLocationAt(now()->subHours(1));
        $recentB = $this->makeLocationAt(now()->subMinutes(10));

        $deleted = $this->service->cleanupOldLocations();

        $this->assertSame(3, $deleted);
        $this->assertSame(2, RunnerLocation::count());
        $this->assertNotNull(RunnerLocation::find($recentA->id));
        $this->assertNotNull(RunnerLocation::find($recentB->id));
    }

    public function test_cleanup_prunes_across_batch_boundaries(): void
    {
        // 5 stale rows with a batch size of 2 → three delete passes (2 + 2 + 1).
        for ($i = 0; $i < 5; $i++) {
            $this->makeLocationAt(now()->subHours(25 + $i));
        }
        // A recent row that must survive every pass.
        $recent = $this->makeLocationAt(now()->subMinutes(5));

        $deleted = $this->service->cleanupOldLocations(24, 2);

        $this->assertSame(5, $deleted);
        $this->assertSame(1, RunnerLocation::count());
        $this->assertNotNull(RunnerLocation::find($recent->id));
    }
}
