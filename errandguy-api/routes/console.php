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
| Times are Asia/Manila (config app.schedule_timezone): the nightly work runs
| between 02:30 and 04:30, when the marketplace is quietest. Stored timestamps
| stay UTC.
*/

// Liveness dead-man's-switch: stamp a heartbeat every minute so GET /health can
// report `scheduler: stale` when the Forge cron stops. The scheduler backstops
// stale-SOS closing, the money/safety reapers, and the nightly backup — if it dies
// silently, all of those stop with no signal. It can't detect its own death, so
// an external monitor polling /health catches it via this heartbeat. Cheap,
// idempotent cache write; 15-min TTL so a dead scheduler's stamp expires.
Schedule::call(fn () => Cache::put('scheduler:heartbeat', now()->timestamp, 900))
    ->everyMinute()
    ->name('scheduler-heartbeat');

// The queue worker's dead-man's-switch: a tiny job the worker stamps when it
// runs it, so /health reports a stopped (or badly backed-up) worker.
Schedule::job(new \App\Jobs\WorkerHeartbeatJob())
    ->everyMinute()
    ->name('worker-heartbeat');

// Prune failed jobs older than 7 days
Schedule::command('queue:prune-failed --hours=168')->dailyAt('03:00');

// Prune completed job batches older than 2 days
Schedule::command('queue:prune-batches --hours=48')->dailyAt('03:05');

// Clear expired cache entries
Schedule::command('cache:prune-stale-tags')->hourly();

// Data retention: runner locations (24h), chats and their photos (30 days after
// the errand ended) and inbox notifications (90 days).
Schedule::command('errandguy:cleanup-locations')->dailyAt('03:15')->onOneServer();

// Supply: nudge runners who started signing up and stopped. A runner registers,
// hits the document gate, has to go find a government ID, and puts the phone
// down meaning to come back — and nothing ever reminded them, so the
// application sat at 'pending' forever and they never earned a peso. Daily at
// 10:00 business time, because a "go photograph your ID" push is useless
// overnight. The command owns the restraint (3 nudges, 48h apart, first
// fortnight only).
Schedule::command('errandguy:send-onboarding-reminders')
    ->dailyAt('10:00')
    ->onOneServer();

// Money-in safety net: settle GCash/Maya tip charges (and legacy top-ups) the
// customer paid for and walked away from. The status endpoint pull-reconciles
// against the gateway, but only while the app is POLLING it — so a dropped
// webhook plus a customer who never reopened the app left money out of their
// GCash and a row stuck 'pending' forever, with nothing on either side
// reconciling it. Every 15 minutes: fast enough that nobody waits long, and
// --limit bounds gateway calls per run.
Schedule::command('errandguy:reconcile-topups')
    ->everyFifteenMinutes()
    ->onOneServer()
    ->withoutOverlapping();

// Money-OUT safety net, and the more painful side: a runner's wallet is debited
// the moment a payout row is created, and the row stays 'pending' until the
// gateway webhook lands. A dropped webhook means their money has left their
// balance with nothing confirming it — and the app won't let them request
// another while one is pending. The wallet list endpoint reconciles on read for
// the runner who checks; this covers the one who doesn't.
Schedule::command('errandguy:reconcile-payouts')
    ->everyFifteenMinutes()
    ->onOneServer()
    ->withoutOverlapping();

// The same safety net for the PRIMARY revenue path, which had none. A booking
// charge's only pull-reconcile was the customer's status poll, and that stops
// the moment they dismiss the pending sheet — so a dropped webhook plus a
// customer who walks away stranded the charge: a paid GCash/Maya errand never
// started matching (matching waits for the confirmed payment), and a payment
// landing on a cancelled errand was never refunded. Also starts a paid errand
// whose search never began, and runs the completed-but-unpaid detective sweep
// — a delivered errand with no settled payment is money already lost, and
// nothing else looks for it.
Schedule::command('errandguy:reconcile-booking-payments')
    ->everyFifteenMinutes()
    ->onOneServer()
    ->withoutOverlapping();

// Reap dead access tokens. Nothing has ever pruned personal_access_tokens, so
// every token any user has ever been issued is still on the row — and the
// sliding session (RotateAccessToken) now leaves the outgoing token behind on
// purpose, so in-flight requests don't 401. The 48h grace keeps a token a
// little past its expiry, well clear of the rotation window, so this can never
// delete something still in use.
Schedule::command('sanctum:prune-expired --hours=48')->dailyAt('03:30')->onOneServer();

// Data retention: bound the money-path dedup tables — expired idempotency_keys
// (dead after their 24h window) and old webhook_events (kept 90d as an audit
// trail). Pruned only outside the replay window, so dedup stays intact. (DATA-9)
Schedule::command('errandguy:prune-dedup-records')->dailyAt('03:45')->onOneServer();

// Operational readiness: log a CRITICAL/WARNING if production is running with
// unsafe/degraded config (APP_DEBUG on, broadcast off, file cache, sync queue)
// that otherwise fails silently. Log-only — can't take the app down.
Schedule::command('errandguy:check-prod-config')->dailyAt('04:30')->onOneServer();

// Money integrity: assert every wallet_balance still equals its ledger (latest
// balance_after) and log a CRITICAL on any out-of-band divergence — the
// detective control for the withdrawable balance given the parallel engine on
// the shared DB. Read-only. (MONEY-6)
Schedule::command('errandguy:reconcile-wallets')->dailyAt('04:00')->onOneServer();

// Disaster-recovery floor: a nightly gzip'd mysqldump plus an archive of the
// uploaded files (runner ID documents, booking media), kept locally and copied
// to the off-site backup disk (config/backup.php), with retention pruning. NOT
// point-in-time recovery — it bounds data loss behind the irreversible
// `migrate --force` deploy until managed PITR exists. The command raises an
// AdminAlert and logs CRITICAL itself when any part fails. onOneServer so a
// multi-server fleet dumps once. (audit DR)
Schedule::command('errandguy:backup-database')->dailyAt('02:30')->onOneServer();

// Matching: rescue bookings whose matched runner never accepted — reset to
// pending and re-match instead of stranding the customer on "Runner Found". Run INLINE so the status-reset survives a queue-worker outage (the
// re-match it then dispatches still needs the worker, but the booking is no
// longer stuck on 'matched').
Schedule::call(fn () => dispatch_sync(new \App\Jobs\ExpireStaleMatchesJob()))
    ->everyMinute()
    ->name('expire-stale-matches')
    ->onOneServer()
    ->withoutOverlapping(10);

// Matching: start the search for a scheduled errand whose one delayed matching
// task was lost (worker down when it came due, queue flushed), and for a paid
// scheduled GCash/Maya errand as its window opens (nothing else starts those,
// since matching waits for the payment). Each errand is
// claimed once via bookings.matching_started_at, and the first search runs
// INLINE so it survives a queue-worker outage. Every minute: the search window
// is only 30 minutes long.
Schedule::command('errandguy:start-due-scheduled-matching')
    ->everyMinute()
    ->onOneServer()
    ->withoutOverlapping(10);

// Honest online counts: a waiting runner silent for 30 minutes (app closed,
// phone off) is switched offline and told by push. Runners holding an offer or
// an errand are never touched.
Schedule::command('errandguy:expire-stale-runner-presence')
    ->everyFiveMinutes()
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
// down, or a crash before it was dispatched), and cancel GCash/Maya errands
// still unpaid after their payment window (ExpireUnpaidBookingJob's backstop). Uses Schedule::command (NOT
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
// runner-held status with no progress past its per-status threshold, so a
// runner who accepted and then went dark no longer goes unnoticed.
// Schedule::command (NOT Schedule::job), like reap-stranded-bookings, so the
// detector survives a queue-worker outage — one of the very ways an errand
// stalls. Notify-only: it raises an operator alert
// and changes no booking state and no money.
Schedule::command('errandguy:detect-stalled-errands')
    ->everyFiveMinutes()
    ->onOneServer()
    ->withoutOverlapping(10);

// Safety: close an SOS still open 24 hours after its errand ended, so a
// forgotten alert doesn't keep the queue and the panel alarm lit forever.
// Logged per alert; an errand still in progress is never touched.
Schedule::command('errandguy:close-stale-sos')
    ->hourly()
    ->onOneServer()
    ->withoutOverlapping(10);

// Out-of-hours alerting for the queues where a waiting user is blocked on a
// human (pending payouts, KYC review, unanswered support). The panel already
// shows these, but only to an admin who happens to be looking. A new SOS is
// emailed the moment it is raised (NotifySosContactsJob), not by this digest.
// The command is inert until a recipient is configured and throttles itself per
// queue, so scheduling it before ops picks a mailbox sends nothing.
Schedule::command('errandguy:admin-queue-alert')
    ->everyFifteenMinutes()
    ->onOneServer()
    ->withoutOverlapping(10);
