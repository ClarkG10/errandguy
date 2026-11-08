<?php

namespace Tests\Feature\Observability;

use App\Models\AdminAlert;
use App\Support\JobFailureReporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A permanently-failed queue job must surface to a human (audit C2/C3). The
 * Queue::failing handler delegates to JobFailureReporter, tested here directly.
 */
class JobFailureReporterTest extends TestCase
{
    use RefreshDatabase;

    public function test_report_raises_an_admin_alert(): void
    {
        JobFailureReporter::report(\App\Jobs\SendPushJob::class, 'connection refused', 'redis');

        $alert = AdminAlert::where('type', 'job_failed')->first();

        $this->assertNotNull($alert, 'a job_failed admin alert should be raised');
        $this->assertSame('error', $alert->severity);
        $this->assertStringContainsString('SendPushJob', $alert->title);
        $this->assertStringContainsString('connection refused', (string) $alert->body);
    }

    public function test_a_realtime_outage_is_one_alert_not_one_per_broadcast(): void
    {
        // Reverb down: every queued broadcast fails within a second. One alert
        // each pushed SOS and money alerts off the first page of Live alerts.
        foreach (['App\\Events\\BookingStatusChanged', 'App\\Events\\ChatMessageSent', 'App\\Events\\IncomingRequest'] as $event) {
            foreach (range(1, 20) as $_) {
                JobFailureReporter::report($event, 'cURL error 7: connection refused', 'redis', isBroadcast: true);
            }
        }
        // The same job failing repeatedly is one alert too.
        foreach (range(1, 5) as $_) {
            JobFailureReporter::report(\App\Jobs\SendPushJob::class, 'timed out', 'redis');
        }

        $alerts = AdminAlert::where('type', 'job_failed')->pluck('title')->all();
        $this->assertSame(['Live updates failed to send (realtime server)', 'Background job failed: SendPushJob'], $alerts);
    }

    public function test_a_failing_scheduled_task_raises_one_alert_an_hour(): void
    {
        $task = new \Illuminate\Console\Scheduling\Event(
            app(\Illuminate\Console\Scheduling\CacheEventMutex::class),
            "'/usr/bin/php8.4' 'artisan' errandguy:reap-stranded-bookings",
        );
        foreach (range(1, 3) as $_) {
            event(new \Illuminate\Console\Events\ScheduledTaskFailed($task, new \RuntimeException('SQLSTATE[HY000]: gone away')));
        }

        $alert = AdminAlert::where('type', 'scheduled_task_failed')->sole();
        $this->assertSame('Scheduled task failed: errandguy:reap-stranded-bookings', $alert->title);
        $this->assertStringContainsString('gone away', (string) $alert->body);
    }
}
