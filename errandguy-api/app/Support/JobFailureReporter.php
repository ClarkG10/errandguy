<?php

namespace App\Support;

use App\Models\AdminAlert;
use Illuminate\Support\Facades\Cache;
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
    public static function report(string $jobName, string $error, ?string $connection = null, bool $isBroadcast = false): void
    {
        // CRITICAL so it stands out in the logs. (The job's exception itself
        // reaches Sentry through the worker's exception reporting once the DSN
        // is set; this log line doesn't — no Sentry logs channel is configured.)
        Log::critical('Queue job failed permanently', [
            'job' => $jobName,
            'connection' => $connection,
            'error' => $error,
        ]);

        // At most one dashboard alert per kind of job per 10 minutes, and one
        // for ALL live-update broadcasts: when the realtime server is down or
        // restarting, every queued broadcast fails within a second, and one
        // alert each pushed a fresh SOS or money alert off the first page of
        // Live alerts. Every failure is still logged above.
        $key = $isBroadcast ? 'broadcast' : $jobName;
        if (! Cache::add('job_failed_alert:'.$key, true, now()->addMinutes(10))) {
            return;
        }

        // Surface on the admin dashboard (ActionQueue widget). AdminAlert::raise
        // swallows its own errors, so a reporting failure can never re-fail the
        // failing-job pipeline.
        AdminAlert::raise(
            'job_failed',
            'error',
            $isBroadcast
                ? 'Live updates failed to send (realtime server)'
                : 'Background job failed: '.class_basename($jobName),
            $isBroadcast
                ? 'Live updates to the app (status, chat, offers) could not be sent: '.$error
                    .' The app falls back to checking every few seconds. Check the realtime (Reverb) server.'
                : $error,
        );
    }
}
