<?php

namespace Tests\Feature\Console;

use App\Console\Commands\CheckProductionConfig;
use Tests\TestCase;

/**
 * Guards the production-config detector: unsafe/degraded settings (APP_DEBUG on,
 * broadcast disabled, file cache, sync queue, no trusted proxies, mail that
 * doesn't send) must each be flagged, and a healthy config must produce nothing.
 */
class CheckProductionConfigTest extends TestCase
{
    /** Read from config (as the middleware does), never env() at runtime. */
    private function setTrustedProxies(string $value): void
    {
        config(['trustedproxy.proxies' => $value]);
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
            'services.semaphore.api_key' => 'semaphore-key',
            'mail.admin_alert_address' => 'ops@errandguy.test',
            'mail.default' => 'gmail',
            'mail.from.address' => 'support@errandguyph.com',
            'mail.mailers.gmail.oauth_client_id' => 'client-id',
            'mail.mailers.gmail.oauth_client_secret' => 'client-secret',
            'mail.mailers.gmail.oauth_refresh_token' => 'refresh-token',
        ]);
        $this->setTrustedProxies('cloudflare');
    }

    public function test_flags_an_sos_that_would_reach_no_one_outside_the_panel(): void
    {
        $this->healthyConfig();
        config([
            'services.semaphore.api_key' => null,
            'mail.admin_alert_address' => null,
        ]);

        $messages = implode(' | ', array_column(CheckProductionConfig::detect(), 'message'));

        $this->assertStringContainsString('SEMAPHORE_API_KEY', $messages);
        $this->assertStringContainsString('ops_alert_emails', $messages);
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

    public function test_a_database_queue_is_a_warning_not_critical(): void
    {
        $this->healthyConfig();
        config(['queue.default' => 'database']);

        $issues = CheckProductionConfig::detect();

        $this->assertCount(1, $issues);
        $this->assertSame('warning', $issues[0]['level']);
        $this->assertStringContainsString('QUEUE_CONNECTION', $issues[0]['message']);
    }

    /**
     * Empty TRUSTED_PROXIES now means "trust nobody", so behind Cloudflare every
     * client shares the edge IP and the per-IP sign-in / code limits lock real
     * users out together — critical, not a warning.
     */
    public function test_empty_trusted_proxies_is_critical(): void
    {
        $this->healthyConfig();
        $this->setTrustedProxies('');

        $issues = CheckProductionConfig::detect();

        $this->assertCount(1, $issues);
        $this->assertSame('critical', $issues[0]['level']);
        $this->assertStringContainsString('TRUSTED_PROXIES', $issues[0]['message']);
    }

    public function test_trusted_proxies_are_read_from_config_not_the_environment(): void
    {
        $this->healthyConfig();
        putenv('TRUSTED_PROXIES=173.245.48.0/20');
        $this->setTrustedProxies('');

        try {
            $messages = implode(' | ', array_column(CheckProductionConfig::detect(), 'message'));
        } finally {
            putenv('TRUSTED_PROXIES');
        }

        $this->assertStringContainsString('TRUSTED_PROXIES', $messages);
    }

    public function test_a_log_mailer_is_critical(): void
    {
        $this->healthyConfig();
        config(['mail.default' => 'log']);

        $issues = CheckProductionConfig::detect();

        $this->assertCount(1, $issues);
        $this->assertSame('critical', $issues[0]['level']);
        $this->assertStringContainsString('MAIL_MAILER', $issues[0]['message']);
    }

    public function test_gmail_without_credentials_is_critical(): void
    {
        $this->healthyConfig();
        config(['mail.mailers.gmail.oauth_refresh_token' => null]);

        $issues = CheckProductionConfig::detect();

        $this->assertCount(1, $issues);
        $this->assertSame('critical', $issues[0]['level']);
        $this->assertStringContainsString('GMAIL_OAUTH', $issues[0]['message']);
    }

    public function test_gmail_with_a_service_account_instead_of_oauth_is_fine(): void
    {
        $this->healthyConfig();
        config([
            'mail.mailers.gmail.oauth_refresh_token' => null,
            'mail.mailers.gmail.credentials_base64' => base64_encode('{}'),
        ]);

        $this->assertSame([], CheckProductionConfig::detect());
    }

    public function test_a_placeholder_from_address_is_a_warning(): void
    {
        $this->healthyConfig();
        config(['mail.from.address' => 'hello@example.com']);

        $issues = CheckProductionConfig::detect();

        $this->assertCount(1, $issues);
        $this->assertSame('warning', $issues[0]['level']);
        $this->assertStringContainsString('MAIL_FROM_ADDRESS', $issues[0]['message']);
    }
}
