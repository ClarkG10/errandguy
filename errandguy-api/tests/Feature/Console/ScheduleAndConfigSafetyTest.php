<?php

namespace Tests\Feature\Console;

use App\Models\SystemConfig;
use App\Support\OpsAlertRecipients;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * Scheduler and config settings that only bite in production:
 *   - the 15-minute money reconcilers hold their overlap lock for 30 minutes,
 *     not the framework's 24-hour default, so one hard-killed run can't
 *     silence a money safety net for a day;
 *   - the ops alert fallback address is read through config (it survives
 *     config:cache), from a key config/mail.php actually defines.
 */
class ScheduleAndConfigSafetyTest extends TestCase
{
    use RefreshDatabase;

    private function scheduled(string $command): Event
    {
        $event = collect(app(Schedule::class)->events())
            ->first(fn (Event $event) => str_contains((string) $event->command, $command));
        $this->assertNotNull($event, "{$command} is scheduled");

        return $event;
    }

    public function test_the_money_reconcilers_hold_their_overlap_lock_for_thirty_minutes(): void
    {
        foreach (['errandguy:reconcile-topups', 'errandguy:reconcile-payouts', 'errandguy:reconcile-booking-payments'] as $command) {
            $event = $this->scheduled($command);

            $this->assertTrue($event->withoutOverlapping, $command);
            $this->assertSame(30, $event->expiresAt, "{$command} must not keep a dead run's lock for 24 hours");
            $this->assertSame('*/15 * * * *', $event->expression, $command);
        }
    }

    public function test_the_ops_alert_fallback_address_comes_from_config(): void
    {
        $this->assertArrayHasKey('admin_alert_address', config('mail'));

        Cache::flush();
        SystemConfig::where('key', OpsAlertRecipients::EMAILS_KEY)->update(['value' => '']);
        SystemConfig::where('key', 'admin_alert_email')->delete();

        config(['mail.admin_alert_address' => 'ops-fallback@errandguy.test']);
        $this->assertSame(['ops-fallback@errandguy.test'], OpsAlertRecipients::emails());

        config(['mail.admin_alert_address' => null]);
        $this->assertSame([], OpsAlertRecipients::emails());
    }

    public function test_the_ci_syntax_check_fails_when_a_file_does_not_parse(): void
    {
        $workflow = base_path('../.github/workflows/backend-ci.yml');
        if (! File::exists($workflow)) {
            $this->markTestSkipped('The CI workflow lives outside this checkout.');
        }

        $yaml = File::get($workflow);
        // `find … -exec php -l {} \;` ignored every result; xargs exits
        // non-zero when any `php -l` fails.
        $this->assertStringNotContainsString('-exec php -l', $yaml);
        $this->assertStringContainsString('-print0 | xargs -0 -n1 php -l', $yaml);
    }

    public function test_the_ops_alert_recipients_never_read_env_at_runtime(): void
    {
        // env() returns null once config is cached, which silently dropped
        // this fallback in production.
        $source = File::get(app_path('Support/OpsAlertRecipients.php'));

        $this->assertDoesNotMatchRegularExpression('/\benv\(/', $source);
    }
}
