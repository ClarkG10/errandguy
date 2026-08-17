<?php

namespace Tests\Feature\Observability;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * /health exposes a scheduler-liveness field fed by the every-minute heartbeat,
 * so a stopped Forge cron is detectable externally — WITHOUT a stale scheduler
 * flipping the load-balancer 200/503 decision (audit C3).
 */
class SchedulerHealthTest extends TestCase
{
    use RefreshDatabase;

    public function test_fresh_heartbeat_reports_ok(): void
    {
        Cache::put('scheduler:heartbeat', now()->timestamp, 900);

        $this->getJson('/health')
            ->assertOk()
            ->assertJsonPath('scheduler', 'ok');
    }

    public function test_stale_heartbeat_reports_stale_but_still_200(): void
    {
        // Cron stopped ~5 minutes ago.
        Cache::put('scheduler:heartbeat', now()->timestamp - 300, 900);

        $this->getJson('/health')
            ->assertOk() // DB + cache are up → must NOT 503 on a cron hiccup
            ->assertJsonPath('scheduler', 'stale');
    }

    public function test_missing_heartbeat_reports_unknown(): void
    {
        Cache::forget('scheduler:heartbeat');

        $this->getJson('/health')
            ->assertOk()
            ->assertJsonPath('scheduler', 'unknown');
    }
}
