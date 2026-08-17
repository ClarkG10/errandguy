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
}
