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

    public function test_profile_position_write_is_throttled_while_history_keeps_flowing(): void
    {
        // Ping 1 — writes history + the denormalised matching position.
        $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.60, 'lng' => 120.98]);

        // Next accepted ping a few seconds later: clear ONLY the 5s ingest gate,
        // leaving the longer profile-position gate in place (simulates real
        // 5s-cadence pings within the profile-throttle window).
        Cache::forget("runner_location_throttle:{$this->runner->id}");

        $this->service->updateRunnerLocation($this->runner->id, ['lat' => 14.70, 'lng' => 121.10]);

        // History appended on both pings (keeps the customer's live pin smooth) …
        $this->assertSame(2, RunnerLocation::where('runner_id', $this->runner->id)->count());

        // … but the matching table's hot row was NOT rewritten on the 2nd ping —
        // still the 1st position (matching tolerates minutes of staleness).
        $profile = RunnerProfile::where('user_id', $this->runner->id)->first();
        $this->assertEquals(14.60, (float) $profile->current_lat);
        $this->assertEquals(120.98, (float) $profile->current_lng);
    }
}
