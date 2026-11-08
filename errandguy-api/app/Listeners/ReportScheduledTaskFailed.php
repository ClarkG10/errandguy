<?php

namespace App\Listeners;

use App\Models\AdminAlert;
use Illuminate\Console\Events\ScheduledTaskFailed;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * A scheduled task that throws or exits non-zero reaches a person.
 *
 * The money backstops (the reconcilers, the stranded-booking reaper, the
 * scheduled-matching start) and the prod-config tripwire all run from the
 * scheduler. A failure was reported to the log only, and the scheduler
 * heartbeat — a separate task — kept /health green, so a backstop could fail
 * every run unnoticed. Queue jobs already raise an alert (JobFailureReporter);
 * this is the same for scheduled tasks.
 *
 * One alert per task per hour: a task failing every minute is one problem,
 * not sixty. The scheduler only sees a failure of a task that runs in the
 * foreground, so these tasks deliberately don't use runInBackground().
 */
class ReportScheduledTaskFailed
{
    public function handle(ScheduledTaskFailed $event): void
    {
        $name = self::taskName($event->task->description, (string) $event->task->command);

        Log::critical('Scheduled task failed', ['task' => $name, 'error' => $event->exception->getMessage()]);

        if (! Cache::add('scheduled_task_failed_alert:'.$name, true, now()->addHour())) {
            return;
        }

        AdminAlert::raise(
            'scheduled_task_failed',
            'error',
            'Scheduled task failed: '.$name,
            Str::limit($event->exception->getMessage(), 400)
                .' It runs again on its own schedule; if this alert comes back, it is failing every run.',
        );
    }

    /** "errandguy:reconcile-wallets" from "'/usr/bin/php' 'artisan' errandguy:reconcile-wallets". */
    public static function taskName(?string $description, string $command): string
    {
        if (filled($description)) {
            return $description;
        }

        return preg_match("/artisan'?\s+'?([\w:-]+)/", $command, $m) === 1 ? $m[1] : Str::limit($command, 80);
    }
}
