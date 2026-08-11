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

// Data retention: bound the money-path dedup tables — expired idempotency_keys
// (dead after their 24h window) and old webhook_events (kept 90d as an audit
// trail). Pruned only outside the replay window, so dedup stays intact. (DATA-9)
Schedule::command('errandguy:prune-dedup-records')->daily();

// Operational readiness: log a CRITICAL/WARNING if production is running with
// unsafe/degraded config (APP_DEBUG on, broadcast off, file cache, sync queue)
// that otherwise fails silently. Log-only — can't take the app down.
Schedule::command('errandguy:check-prod-config')->daily();

// Money integrity: assert every wallet_balance still equals its ledger (latest
// balance_after) and log a CRITICAL on any out-of-band divergence — the
// detective control for the withdrawable balance given the parallel engine on
// the shared DB. Read-only. (MONEY-6)
Schedule::command('errandguy:reconcile-wallets')->daily();

// Safety: alert when an in-transit transportation ride runs well over its
// estimated duration. Previously defined but NEVER scheduled, so the monitor
// never ran. withoutOverlapping guards against a slow run stacking.
Schedule::job(new \App\Jobs\CheckRideDurationJob())
    ->everyFiveMinutes()
    ->withoutOverlapping();

// Matching: rescue fixed-price bookings whose matched runner never accepted —
// reset to pending and re-match (excluding the unresponsive runner) instead of
// stranding the customer on "Runner Found". Bounded by AutoCancelBookingJob.
Schedule::job(new \App\Jobs\ExpireStaleMatchesJob())
    ->everyMinute()
    ->withoutOverlapping();

// Money-safety backstop: cancel + refund prepaid bookings stranded past the
// auto-cancel window when the DELAYED AutoCancelBookingJob never ran (worker
// down, or a crash before it was dispatched). Uses Schedule::command (NOT
// Schedule::job) so it runs in the scheduler process and survives a queue-worker
// outage — the exact failure it guards against. Idempotent + row-locked, so
// withoutOverlapping just avoids a slow run stacking. (SCALE-REL-1/5)
Schedule::command('errandguy:reap-stranded-bookings')
    ->everyFiveMinutes()
    ->withoutOverlapping();
