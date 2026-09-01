<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
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

// Liveness dead-man's-switch: stamp a heartbeat every minute so GET /health can
// report `scheduler: stale` when the Forge cron stops. The scheduler backstops
// SOS fan-out, the money/safety reapers, and the nightly backup — if it dies
// silently, all of those stop with no signal. It can't detect its own death, so
// an external monitor polling /health catches it via this heartbeat. Cheap,
// idempotent cache write; 15-min TTL so a dead scheduler's stamp expires.
Schedule::call(fn () => Cache::put('scheduler:heartbeat', now()->timestamp, 900))
    ->everyMinute()
    ->name('scheduler-heartbeat');

// Prune failed jobs older than 7 days
Schedule::command('queue:prune-failed --hours=168')->daily();

// Prune completed job batches older than 2 days
Schedule::command('queue:prune-batches --hours=48')->daily();

// Clear expired cache entries
Schedule::command('cache:prune-stale-tags')->hourly();

// Data retention: cleanup old locations (24h) and messages (30d post-completion)
Schedule::command('errandguy:cleanup-locations')->daily()->onOneServer();

// Data retention: bound the money-path dedup tables — expired idempotency_keys
// (dead after their 24h window) and old webhook_events (kept 90d as an audit
// trail). Pruned only outside the replay window, so dedup stays intact. (DATA-9)
Schedule::command('errandguy:prune-dedup-records')->daily()->onOneServer();

// Operational readiness: log a CRITICAL/WARNING if production is running with
// unsafe/degraded config (APP_DEBUG on, broadcast off, file cache, sync queue)
// that otherwise fails silently. Log-only — can't take the app down.
Schedule::command('errandguy:check-prod-config')->daily()->onOneServer();

// Money integrity: assert every wallet_balance still equals its ledger (latest
// balance_after) and log a CRITICAL on any out-of-band divergence — the
// detective control for the withdrawable balance given the parallel engine on
// the shared DB. Read-only. (MONEY-6)
Schedule::command('errandguy:reconcile-wallets')->daily()->onOneServer();

// Disaster-recovery floor: a nightly gzip'd mysqldump to the configured backup
// disk (config/backup.php) with retention pruning. NOT point-in-time recovery —
// it bounds data loss behind the irreversible `migrate --force` deploy until
// managed PITR exists. onOneServer so a multi-server fleet dumps once. (audit DR)
Schedule::command('errandguy:backup-database')->dailyAt('02:30')->onOneServer();

// Safety: alert when an in-transit transportation ride runs well over its
// estimated duration. Run INLINE in the scheduler (dispatch_sync), NOT via
// Schedule::job — a queued job dies silently when the worker is down, and this
// is a safety monitor that must fire regardless. (audit v3 devops)
Schedule::call(fn () => dispatch_sync(new \App\Jobs\CheckRideDurationJob()))
    ->everyFiveMinutes()
    ->name('check-ride-duration')
    ->onOneServer()
    ->withoutOverlapping(10);

// Matching: rescue fixed-price bookings whose matched runner never accepted —
// reset to pending and re-match instead of stranding the customer on "Runner
// Found". Run INLINE so the status-reset survives a queue-worker outage (the
// re-match it then dispatches still needs the worker, but the booking is no
// longer stuck on 'matched').
Schedule::call(fn () => dispatch_sync(new \App\Jobs\ExpireStaleMatchesJob()))
    ->everyMinute()
    ->name('expire-stale-matches')
    ->onOneServer()
    ->withoutOverlapping(10);

// Convenience: one "your scheduled errand is coming up" reminder ~30 minutes
// before a scheduled booking's window opens — the last FREE-cancellation moment,
// which previously passed in silence (nothing between the create confirmation and
// "Runner Found!" at scheduled_at−15min). A sweep rather than a days-long delayed
// job (which a worker restart loses); idempotent via a per-booking cache flag, so
// a double run can't double-push. Notification-only — no money, no state changes.
Schedule::command('errandguy:send-scheduled-reminders')
    ->everyFiveMinutes()
    ->onOneServer()
    ->withoutOverlapping(10);

// Money-safety backstop: cancel + refund prepaid bookings stranded past the
// auto-cancel window when the DELAYED AutoCancelBookingJob never ran (worker
// down, or a crash before it was dispatched). Uses Schedule::command (NOT
// Schedule::job) so it runs in the scheduler process and survives a queue-worker
// outage — the exact failure it guards against. onOneServer avoids a double-run
// (double refund is idempotently blocked anyway) across a multi-server fleet;
// the explicit 10-minute withoutOverlapping TTL means a hard-killed run can't
// silence the backstop for the framework-default 24h. (SCALE-REL-1/5)
Schedule::command('errandguy:reap-stranded-bookings')
    ->everyFiveMinutes()
    ->onOneServer()
    ->withoutOverlapping(10);

// Safety/ops: raise a "may be stalled" admin alert for an errand sitting in a
// runner-held status with no progress past its per-status threshold. The only
// prior duration monitor (check-ride-duration above) covers TRANSPORTATION in
// transit only, so a delivery runner who accepted and then went dark was
// detected by nothing. Schedule::command (NOT Schedule::job), like
// reap-stranded-bookings, so the detector survives a queue-worker outage — one
// of the very ways an errand stalls. Notify-only: it raises an operator alert
// and changes no booking state and no money.
Schedule::command('errandguy:detect-stalled-errands')
    ->everyFiveMinutes()
    ->onOneServer()
    ->withoutOverlapping(10);

// Out-of-hours alerting for the queues where a waiting user is blocked on a
// human (pending payouts, KYC review, open disputes, unanswered support). The
// panel already shows these, but only to an admin who happens to be looking.
// The command is inert until a recipient is configured and throttles itself per
// queue, so scheduling it before ops picks a mailbox sends nothing.
Schedule::command('errandguy:admin-queue-alert')
    ->everyFifteenMinutes()
    ->onOneServer()
    ->withoutOverlapping(10);
