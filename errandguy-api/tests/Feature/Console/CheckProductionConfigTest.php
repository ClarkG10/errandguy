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

    public function test_healthy_production_config_reports_nothing(): void
    {
        config([
            'app.debug' => false,
            'broadcasting.default' => 'reverb',
            'cache.default' => 'redis',
            'queue.default' => 'redis',
        ]);
        $this->setTrustedProxies('173.245.48.0/20'); // a configured proxy range

        $this->assertSame([], CheckProductionConfig::detect());
    }

    public function test_database_queue_and_empty_proxies_are_warnings_not_critical(): void
    {
        config([
            'app.debug' => false,
            'broadcasting.default' => 'reverb',
            'cache.default' => 'redis',
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
