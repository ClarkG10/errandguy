<?php

namespace Tests\Feature\Console;

use App\Console\Commands\Preflight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * The launch-gate command: exits non-zero on ANY critical (unsafe config, pending
 * migrations, a dead scheduler) so a deploy/CI step can gate on it, while
 * warnings (no-heartbeat-yet, on-box backups) stay launchable.
 */
class PreflightTest extends TestCase
{
    use RefreshDatabase;

    /** A config with NO criticals (warnings like empty proxies / on-box backups are fine). */
    private function noCriticalConfig(): void
    {
        config([
            'app.debug' => false,
            'app.url' => 'https://api.errandguy.app',
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.key' => 'k',
            'broadcasting.connections.reverb.secret' => 's',
            'broadcasting.connections.reverb.app_id' => '900',
            // Leave cache.default as the test's 'array' store — 'file' would be a
            // warning (not a critical) and 'redis' can't connect in this env.
            'queue.default' => 'redis',
            'sentry.dsn' => 'https://public@o1.ingest.sentry.io/1',
        ]);
        // Fresh scheduler heartbeat (cron alive).
        Cache::put('scheduler:heartbeat', now()->timestamp, 900);
    }

    public function test_clean_state_passes_the_gate(): void
    {
        $this->noCriticalConfig();

        $this->artisan('errandguy:preflight')->assertExitCode(0);
    }

    public function test_a_config_critical_fails_the_gate(): void
    {
        $this->noCriticalConfig();
        config(['app.debug' => true]); // APP_DEBUG on is a critical

        $this->artisan('errandguy:preflight')->assertExitCode(1);
    }

    public function test_a_stale_scheduler_heartbeat_fails_the_gate(): void
    {
        $this->noCriticalConfig();
        Cache::put('scheduler:heartbeat', now()->timestamp - 3600, 900); // 1h old → stale

        $this->artisan('errandguy:preflight')->assertExitCode(1);
    }

    public function test_a_missing_heartbeat_is_a_warning_not_a_failure(): void
    {
        $this->noCriticalConfig();
        Cache::forget('scheduler:heartbeat'); // inconclusive, not proof of a dead cron

        $this->artisan('errandguy:preflight')->assertExitCode(0);

        $scheduler = collect(Preflight::checks())->firstWhere('check', 'scheduler');
        $this->assertSame('warning', $scheduler['level']);
        $this->assertFalse($scheduler['ok']);
    }

    public function test_migrations_report_up_to_date_under_a_migrated_schema(): void
    {
        $migrations = collect(Preflight::checks())->firstWhere('check', 'migrations');

        $this->assertTrue($migrations['ok']);
        $this->assertSame('critical', $migrations['level']);
    }
}
