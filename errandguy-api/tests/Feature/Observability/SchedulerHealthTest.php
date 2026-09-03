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
            ->assertJsonPath('scheduler', 'ok')
            ->assertJsonPath('status', 'ok');
    }

    /**
     * The top-level `status` is the field an ordinary uptime monitor reads.
     *
     * Reporting "ok" while every scheduled job is dead is exactly how a stopped
     * cron hid for weeks in production: the heartbeat existed, but catching it
     * required a monitor configured to read a nested field, and nobody had set
     * one up. A dead scheduler means no nightly database backup, no
     * stale-match reassignment and no money reconciliation.
     */
    public function test_a_dead_scheduler_makes_the_top_level_status_degraded(): void
    {
        Cache::forget('scheduler:heartbeat');

        $this->getJson('/health')
            // Still 200 — requests are being served fine and a serving box must
            // not be pulled from the load balancer over a cron.
            ->assertOk()
            ->assertJsonPath('status', 'degraded')
            ->assertJsonPath('checks.database', 'up');
    }

    public function test_a_stale_scheduler_also_degrades_the_top_level_status(): void
    {
        Cache::put('scheduler:heartbeat', now()->timestamp - 300, 900);

        $this->getJson('/health')
            ->assertOk()
            ->assertJsonPath('status', 'degraded');
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
