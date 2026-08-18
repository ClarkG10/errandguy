<?php

namespace Tests\Feature\Console;

use App\Console\Commands\CheckProductionConfig;
use Tests\TestCase;

/**
 * Guards the production-config detector: unsafe/degraded settings (APP_DEBUG on,
 * broadcast disabled, file cache, sync queue, no trusted proxies) must each be
 * flagged, and a healthy config must produce nothing.
 */
class CheckProductionConfigTest extends TestCase
{
    private function setTrustedProxies(string $value): void
    {
        putenv($value === '' ? 'TRUSTED_PROXIES' : "TRUSTED_PROXIES={$value}");
        $_ENV['TRUSTED_PROXIES'] = $value;
        $_SERVER['TRUSTED_PROXIES'] = $value;
    }

    protected function tearDown(): void
    {
        putenv('TRUSTED_PROXIES');
        unset($_ENV['TRUSTED_PROXIES'], $_SERVER['TRUSTED_PROXIES']);
        parent::tearDown();
    }

    public function test_flags_each_unsafe_setting(): void
    {
        config([
            'app.debug' => true,
            'broadcasting.default' => 'null',
            'cache.default' => 'file',
            'queue.default' => 'sync',
        ]);
        $this->setTrustedProxies(''); // empty → flagged

        $issues = CheckProductionConfig::detect();
        $messages = implode(' | ', array_column($issues, 'message'));

        $this->assertStringContainsString('APP_DEBUG', $messages);
        $this->assertStringContainsString('BROADCAST_CONNECTION', $messages);
        $this->assertStringContainsString('CACHE_STORE', $messages);
        $this->assertStringContainsString('QUEUE_CONNECTION', $messages);
        $this->assertStringContainsString('TRUSTED_PROXIES', $messages);
        // APP_DEBUG and sync queue are the CRITICAL ones.
        $criticals = array_filter($issues, fn ($i) => $i['level'] === 'critical');
        $this->assertGreaterThanOrEqual(2, count($criticals));
    }

    /**
     * A fully-healthy production config: all drivers correct AND observability +
     * realtime credentials + canonical URL present. Used as the baseline so a
     * new check that fires here is caught immediately.
     */
    private function healthyConfig(): void
    {
        config([
            'app.debug' => false,
            'app.url' => 'https://api.errandguy.app',
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.key' => 'appkey',
            'broadcasting.connections.reverb.secret' => 'appsecret',
            'broadcasting.connections.reverb.app_id' => '900123',
            'cache.default' => 'redis',
            'queue.default' => 'redis',
            'sentry.dsn' => 'https://public@o1.ingest.sentry.io/123',
        ]);
        $this->setTrustedProxies('173.245.48.0/20'); // a configured proxy range
    }

    public function test_healthy_production_config_reports_nothing(): void
    {
        $this->healthyConfig();

        $this->assertSame([], CheckProductionConfig::detect());
    }

    public function test_flags_blindness_and_dead_realtime_and_bad_app_url(): void
    {
        // Start healthy, then break the three observability/realtime/URL knobs.
        $this->healthyConfig();
        config([
            'sentry.dsn' => '',                                  // → blind (warning)
            'broadcasting.connections.reverb.secret' => '',      // reverb selected, uncredentialed → critical
            'app.url' => 'http://localhost',                     // → broken links (warning)
        ]);

        $issues = CheckProductionConfig::detect();
        $messages = implode(' | ', array_column($issues, 'message'));

        $this->assertStringContainsString('SENTRY_LARAVEL_DSN', $messages);
        $this->assertStringContainsString('REVERB_APP_KEY/SECRET/ID', $messages);
        $this->assertStringContainsString('APP_URL', $messages);
        // The dead-realtime one is critical (money-adjacent flows depend on it).
        $criticals = array_filter($issues, fn ($i) => $i['level'] === 'critical');
        $this->assertStringContainsString('reverb', implode(' ', array_column($criticals, 'message')));
    }

    public function test_database_queue_and_empty_proxies_are_warnings_not_critical(): void
    {
        $this->healthyConfig();
        config([
            'queue.default' => 'database',
        ]);
        $this->setTrustedProxies(''); // empty → warning

        $issues = CheckProductionConfig::detect();

        $this->assertCount(2, $issues); // queue=database + empty proxies
        $this->assertEmpty(array_filter($issues, fn ($i) => $i['level'] === 'critical'));
        $messages = implode(' | ', array_column($issues, 'message'));
        $this->assertStringContainsString('QUEUE_CONNECTION', $messages);
        $this->assertStringContainsString('TRUSTED_PROXIES', $messages);
    }
}
