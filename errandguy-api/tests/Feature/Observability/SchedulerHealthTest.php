<?php

namespace Tests\Feature\Observability;

use App\Jobs\WorkerHeartbeatJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * /health reports scheduler liveness from the every-minute heartbeat, and a
 * dead or stale scheduler now FAILS the probe (503): a stopped cron means no
 * nightly backup, no stale-match reassignment and no money reconciliation, and
 * an outside uptime monitor only alerts on a non-200. (audit C3)
 */
class SchedulerHealthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // The worker is alive in these tests; only the scheduler varies.
        Cache::put(WorkerHeartbeatJob::CACHE_KEY, now()->timestamp, 900);
    }

    public function test_fresh_heartbeat_reports_ok(): void
    {
        Cache::put('scheduler:heartbeat', now()->timestamp, 900);

        $this->getJson('/health')
            ->assertOk()
            ->assertJsonPath('scheduler', 'ok')
            ->assertJsonPath('checks.scheduler', 'ok')
            ->assertJsonPath('status', 'ok');
    }

    public function test_a_stale_scheduler_fails_the_probe(): void
    {
        // Cron stopped ~5 minutes ago.
        Cache::put('scheduler:heartbeat', now()->timestamp - 300, 900);

        $this->getJson('/health')
            ->assertStatus(503)
            ->assertJsonPath('status', 'degraded')
            ->assertJsonPath('scheduler', 'stale')
            ->assertJsonPath('checks.database', 'up');
    }

    public function test_a_missing_heartbeat_reports_unknown_and_fails_the_probe(): void
    {
        Cache::forget('scheduler:heartbeat');

        $this->getJson('/health')
            ->assertStatus(503)
            ->assertJsonPath('scheduler', 'unknown');
    }
}
