<?php

namespace Tests\Feature\Console;

use App\Console\Commands\Preflight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The launch-gate command: exits non-zero on ANY critical (unsafe config, pending
 * migrations, a dead scheduler, local-only backups in production, an off-site
 * backup disk that won't take a write) so a deploy/CI step can gate on it,
 * while warnings (no-heartbeat-yet) stay launchable.
 */
class PreflightTest extends TestCase
{
    use RefreshDatabase;

    /** A config with NO criticals (warnings like on-box backups outside production are fine). */
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
            'trustedproxy.proxies' => 'cloudflare',
            'mail.default' => 'gmail',
            'mail.from.address' => 'support@errandguyph.com',
            'mail.mailers.gmail.oauth_client_id' => 'id',
            'mail.mailers.gmail.oauth_client_secret' => 'secret',
            'mail.mailers.gmail.oauth_refresh_token' => 'token',
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

    // ── Off-site backups ──────────────────────────────────────────────

    private function backupsCheck(): array
    {
        return collect(Preflight::checks())->firstWhere('check', 'off-site backups');
    }

    public function test_local_only_backups_fail_the_gate_in_production(): void
    {
        $this->noCriticalConfig();
        config(['backup.disk' => 'local']);
        $this->app['env'] = 'production';

        try {
            $check = $this->backupsCheck();
            $this->assertSame('critical', $check['level']);
            $this->assertFalse($check['ok']);
            $this->artisan('errandguy:preflight')->assertExitCode(1);
        } finally {
            $this->app['env'] = 'testing';
        }
    }

    public function test_local_only_backups_are_a_warning_outside_production(): void
    {
        $this->noCriticalConfig();
        config(['backup.disk' => 'local']);

        $check = $this->backupsCheck();
        $this->assertSame('warning', $check['level']);
        $this->assertFalse($check['ok']);
    }

    public function test_a_disk_that_is_a_local_folder_counts_as_local_only(): void
    {
        $this->noCriticalConfig();
        config(['backup.disk' => 'public']);

        $this->assertFalse($this->backupsCheck()['ok']);
    }

    public function test_a_writable_offsite_disk_passes_and_leaves_no_probe_behind(): void
    {
        $this->noCriticalConfig();
        config(['backup.disk' => 's3']);
        Storage::fake('s3');

        $check = $this->backupsCheck();

        $this->assertTrue($check['ok'], $check['message']);
        $this->assertSame('critical', $check['level']);
        $this->assertSame([], Storage::disk('s3')->allFiles());
        $this->artisan('errandguy:preflight')->assertExitCode(0);
    }

    public function test_an_offsite_disk_that_refuses_writes_fails_the_gate(): void
    {
        $this->noCriticalConfig();
        config(['backup.disk' => 's3']);
        $disk = \Mockery::mock(\Illuminate\Contracts\Filesystem\Filesystem::class);
        $disk->shouldReceive('put')->andReturn(false);
        $disk->shouldReceive('get')->andReturn(null);
        $disk->shouldReceive('delete')->andReturn(true);
        Storage::set('s3', $disk);

        $check = $this->backupsCheck();

        $this->assertFalse($check['ok']);
        $this->assertSame('critical', $check['level']);
        $this->assertStringContainsString('not writable', $check['message']);
        $this->artisan('errandguy:preflight')->assertExitCode(1);
    }
}
