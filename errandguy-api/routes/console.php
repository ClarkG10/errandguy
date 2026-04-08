<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
|--------------------------------------------------------------------------
| Scheduled Tasks
|--------------------------------------------------------------------------
| Queue maintenance and cleanup tasks.
*/

// Prune failed jobs older than 7 days
Schedule::command('queue:prune-failed --hours=168')->daily();

// Prune completed job batches older than 2 days
Schedule::command('queue:prune-batches --hours=48')->daily();

// Clear expired cache entries
Schedule::command('cache:prune-stale-tags')->hourly();

// Data retention: cleanup old locations (24h) and messages (30d post-completion)
Schedule::command('errandguy:cleanup-locations')->daily();
