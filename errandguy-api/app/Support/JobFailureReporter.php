<?php

namespace App\Support;

use App\Models\AdminAlert;
use Illuminate\Support\Facades\Log;

/**
 * Turns a permanently-failed queue job into a signal a human actually sees.
 *
 * Wired to Queue::failing() in AppServiceProvider. Without it, a failed
 * payment-settlement / SOS-fan-out / push / broadcast job lands silently in
 * `failed_jobs` (pruned after 7 days) and nobody is paged — for a payments app
 * that's the difference between a 5-minute and a 5-hour incident. Queue::failing
 * fires once per job AFTER retries are exhausted (not per-retry), so this does
 * not storm on a flapping job.
 *
 * Extracted from the closure so the reporting logic is unit-testable without a
 * running worker.
 */
class JobFailureReporter
{
    public static function report(string $jobName, string $error, ?string $connection = null): void
    {
        // CRITICAL so it stands out in the logs and is picked up by the Sentry
        // logs channel once the DSN is set.
        Log::critical('Queue job failed permanently', [
            'job' => $jobName,
            'connection' => $connection,
            'error' => $error,
        ]);

        // Surface on the admin dashboard (ActionQueue widget). AdminAlert::raise
        // swallows its own errors, so a reporting failure can never re-fail the
        // failing-job pipeline.
        AdminAlert::raise(
            'job_failed',
            'error',
            'Background job failed: '.class_basename($jobName),
            $error,
        );
    }
}
