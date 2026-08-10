<?php

namespace Tests\Feature\Console;

use App\Console\Commands\CheckProductionConfig;
use Tests\TestCase;

/**
 * Guards the production-config detector: unsafe/degraded settings (APP_DEBUG on,
 * broadcast disabled, file cache, sync queue) must each be flagged, and a
 * healthy config must produce nothing.
 */
class CheckProductionConfigTest extends TestCase
{
    public function test_flags_each_unsafe_setting(): void
    {
        config([
            'app.debug' => true,
            'broadcasting.default' => 'null',
            'cache.default' => 'file',
            'queue.default' => 'sync',
        ]);

        $issues = CheckProductionConfig::detect();
        $messages = implode(' | ', array_column($issues, 'message'));

        $this->assertStringContainsString('APP_DEBUG', $messages);
        $this->assertStringContainsString('BROADCAST_CONNECTION', $messages);
        $this->assertStringContainsString('CACHE_STORE', $messages);
        $this->assertStringContainsString('QUEUE_CONNECTION', $messages);
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

        $this->assertSame([], CheckProductionConfig::detect());
    }

    public function test_database_queue_is_a_warning_not_critical(): void
    {
        config([
            'app.debug' => false,
            'broadcasting.default' => 'reverb',
            'cache.default' => 'redis',
            'queue.default' => 'database',
        ]);

        $issues = CheckProductionConfig::detect();
        $this->assertCount(1, $issues);
        $this->assertSame('warning', $issues[0]['level']);
        $this->assertStringContainsString('QUEUE_CONNECTION', $issues[0]['message']);
    }
}
