<?php

namespace App\Console\Commands;

use App\Mail\AdminQueueDigest;
use App\Models\DisputeTicket;
use App\Models\RunnerProfile;
use App\Models\SOSAlert;
use App\Models\SupportTicket;
use App\Models\SystemConfig;
use App\Models\WalletTransaction;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Out-of-panel alerting for the queues where a HUMAN is the bottleneck.
 *
 * Today every one of those queues is watched only from inside /admin: the
 * ActionQueue widget polls every 30s in the browser and the resource nav badges
 * render per page load. AdminAlert::raise (SOS, no_runner, job failures) also
 * only surfaces in the panel. So overnight or off-hours a runner's KYC, a payout
 * request, a dispute or an unanswered support thread can age for many hours for
 * one reason only: nobody was looking. Meanwhile the app already has a working
 * mail transport (Gmail API, AppServiceProvider) used for OTP + password reset.
 *
 * This command closes that loop with NO new service: it re-runs the same queue
 * queries the ActionQueue widget encodes, and emails the ops address when a
 * queue is non-empty AND its oldest item has passed that queue's SLA.
 *
 * INERT UNTIL CONFIGURED — it silently does nothing until an address is set
 * (see recipients()), so scheduling it is safe before ops picks a mailbox.
 *
 * THROTTLED PER QUEUE — each breached queue claims a cache flag
 * (`admin_queue_alert:{key}`) for `admin_alert_throttle_hours` (default 6), so a
 * genuinely stuck queue mails once per window instead of once per run. A send
 * failure releases the flags it claimed so the next run retries.
 *
 * Read-only + best-effort: it never mutates domain state and never touches money.
 *
 * SCHEDULE (routes/console.php owns registration — see the report):
 *   Schedule::command('errandguy:admin-queue-alert')->everyFifteenMinutes()->onOneServer()->withoutOverlapping(10);
 */
class AdminQueueAlertCommand extends Command
{
    protected $signature = 'errandguy:admin-queue-alert
        {--dry-run : Print what would be emailed without sending or consuming the throttle}';

    protected $description = 'Email the ops address when a user-blocking admin queue (SOS, KYC, payouts, disputes, support) breaches its SLA. Inert until ADMIN_ALERT_EMAIL / system_config admin_alert_email is set.';

    /** Hours a breached queue stays silent after it mails, unless overridden. */
    private const DEFAULT_THROTTLE_HOURS = 6;

    /** Bounds on the configurable throttle so a bad value can't silence or spam. */
    private const MIN_THROTTLE_HOURS = 1;

    private const MAX_THROTTLE_HOURS = 168;

    public function handle(): int
    {
        $breaches = self::breaches();

        if ($breaches === []) {
            $this->info('All operational queues are inside their SLA — nothing to alert.');

            return self::SUCCESS;
        }

        $recipients = self::recipients();
        if ($recipients === []) {
            // Deliberately quiet: an unconfigured alert address is a setup state,
            // not an error, and this runs every 15 minutes.
            $this->line('<comment>'.count($breaches).' queue(s) breached, but no alert address is configured</comment> — set system_config `admin_alert_email` (or ADMIN_ALERT_EMAIL) to enable emails.');

            return self::SUCCESS;
        }

        $dryRun = (bool) $this->option('dry-run');

        // Claim the per-queue throttle BEFORE sending, release on failure.
        $ttl = self::throttleHours() * 3600;
        $send = [];
        $claimed = [];
        foreach ($breaches as $breach) {
            if ($dryRun) {
                $send[] = $breach;

                continue;
            }
            $key = 'admin_queue_alert:'.$breach['key'];
            if (Cache::add($key, true, $ttl)) {
                $claimed[] = $key;
                $send[] = $breach;
            }
        }

        if ($send === []) {
            $this->info(count($breaches).' queue(s) breached but all are inside their alert throttle window.');

            return self::SUCCESS;
        }

        foreach ($send as $breach) {
            $this->line(sprintf(
                '<comment>%s</comment>: %d waiting, oldest %s (SLA %s)',
                $breach['label'],
                $breach['count'],
                $breach['oldest_human'],
                $breach['threshold_label'],
            ));
        }

        if ($dryRun) {
            $this->info('Dry run — no email sent, throttle untouched. Would notify: '.implode(', ', $recipients));

            return self::SUCCESS;
        }

        try {
            Mail::to($recipients)->send(new AdminQueueDigest($send));
        } catch (\Throwable $e) {
            // Release the claims so the next run retries instead of the breach
            // going silent for a whole throttle window because mail was down.
            foreach ($claimed as $key) {
                Cache::forget($key);
            }
            Log::error('[admin-queue-alert] failed to send the ops digest', [
                'queues' => array_column($send, 'key'),
                'error' => $e->getMessage(),
            ]);
            $this->error('Failed to send the ops digest: '.$e->getMessage());

            return self::FAILURE;
        }

        // WARNING, not INFO: a sent digest means users were waiting on a human
        // past the SLA — worth finding in the log after the fact.
        Log::warning('[admin-queue-alert] ops digest sent', [
            'queues' => array_column($send, 'key'),
            'recipients' => count($recipients),
        ]);
        $this->info('Ops digest sent to '.implode(', ', $recipients).'.');

        return self::SUCCESS;
    }

    /**
     * Where the digest goes. Resolution order, first non-empty wins:
     *   1. system_config `admin_alert_email` — changeable without a deploy;
     *   2. config('mail.admin_alert_address') — config:cache-safe hook if/when
     *      it is added to config/mail.php (see the report's follow-up);
     *   3. env('ADMIN_ALERT_EMAIL') — works locally / uncached; note that with
     *      `config:cache` Laravel skips .env loading, so (1) or (2) is the
     *      production path.
     * Accepts a comma-separated list. Invalid entries are dropped; an empty
     * result keeps the command inert.
     *
     * @return array<int,string>
     */
    public static function recipients(): array
    {
        $raw = null;
        try {
            $raw = SystemConfig::getValue('admin_alert_email');
        } catch (\Throwable $e) {
            // Table missing / DB unreachable — fall through to config + env.
        }
        if (! is_string($raw) || trim($raw) === '') {
            $raw = config('mail.admin_alert_address') ?: env('ADMIN_ALERT_EMAIL');
        }
        if (! is_string($raw) || trim($raw) === '') {
            return [];
        }

        $emails = [];
        foreach (explode(',', $raw) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate !== '' && filter_var($candidate, FILTER_VALIDATE_EMAIL)) {
                $emails[] = $candidate;
            }
        }

        return array_values(array_unique($emails));
    }

    /** Hours between repeat alerts for the same queue (system_config tunable). */
    public static function throttleHours(): int
    {
        $hours = self::DEFAULT_THROTTLE_HOURS;
        try {
            $configured = SystemConfig::getValue('admin_alert_throttle_hours');
            if (is_string($configured) && is_numeric(trim($configured))) {
                $hours = (int) trim($configured);
            }
        } catch (\Throwable $e) {
            // Keep the default.
        }

        return max(self::MIN_THROTTLE_HOURS, min(self::MAX_THROTTLE_HOURS, $hours));
    }

    /**
     * The queues that are BOTH non-empty and past their SLA, newest-breach last.
     *
     * Each entry is display-ready (no Carbon instances) so the Mailable stays
     * trivially serializable:
     *   key, label, count, oldest_human, age_minutes, threshold_label, note
     *
     * Kept static + side-effect-free so it is testable and re-usable.
     *
     * @return array<int, array{key:string,label:string,count:int,oldest_human:string,age_minutes:int,threshold_label:string,note:string}>
     */
    public static function breaches(): array
    {
        $breaches = [];

        // Threshold 0 → any active alert alerts immediately (life-safety; the
        // ActionQueue widget likewise paints SOS red the moment it is non-zero).
        $breaches[] = self::evaluate(
            'sos', 'Active SOS', 0, 'immediately',
            'A user has an SOS alert open. Respond now.',
            fn () => SOSAlert::where('status', 'active'),
            'triggered_at',
        );

        // 24h mirrors ActionQueue's amber escalation for pending verifications.
        // Same definition as the panel card this email points at: READY
        // applications only (both required docs uploaded, none rejected). The
        // bare pending count includes every account that registered and never
        // uploaded a document — an email saying "37 waiting" against a panel
        // showing 4 ready teaches admins the email lies.
        $breaches[] = self::evaluate(
            'kyc', 'Runner verifications ready for review', 1440, '24 hours',
            'Runners cannot earn until their KYC is reviewed.',
            fn () => RunnerProfile::query()->pending()->readyForReview(),
        );

        // 12h mirrors ActionQueue's payout escalation.
        $breaches[] = self::evaluate(
            'payouts', 'Pending payouts', 720, '12 hours',
            'Runners are waiting on money already debited from their wallet.',
            fn () => WalletTransaction::where('type', 'payout')->where('status', 'pending'),
        );

        // 4h mirrors ActionQueue's dispute escalation.
        $breaches[] = self::evaluate(
            'disputes', 'Open disputes', 240, '4 hours',
            'A customer or runner is contesting an errand outcome.',
            fn () => DisputeTicket::unresolved(),
        );

        // Same definition as the panel's "Needs reply" tab: never answered, OR
        // the last message in the thread is the user's — a customer replying
        // to an agent puts the ball back in our court even though the status
        // long left 'open'. Age from the last message exactly like the list.
        $breaches[] = self::evaluate(
            'support', 'Support tickets awaiting a reply', 240, '4 hours',
            'Users are waiting for a reply in their support thread.',
            fn () => SupportTicket::needsReply(),
            'COALESCE(last_message_at, created_at)',
            raw: true,
        );

        return array_values(array_filter($breaches));
    }

    /**
     * Count a queue and decide whether it has breached. Returns null when the
     * queue is empty, still inside its SLA, or the query fails (a missing table
     * on a partially-migrated environment must not break the whole digest).
     *
     * @param  callable():\Illuminate\Database\Eloquent\Builder  $query
     * @return array{key:string,label:string,count:int,oldest_human:string,age_minutes:int,threshold_label:string,note:string}|null
     */
    private static function evaluate(
        string $key,
        string $label,
        int $thresholdMinutes,
        string $thresholdLabel,
        string $note,
        callable $query,
        string $ageColumn = 'created_at',
        bool $raw = false,
    ): ?array {
        try {
            $count = $query()->count();
            if ($count < 1) {
                return null;
            }

            // `raw` queues age from an expression (COALESCE) rather than a
            // column; toBase() keeps the aggregate off the Eloquent caster.
            $oldest = $raw
                ? $query()->toBase()->selectRaw("MIN({$ageColumn}) as oldest")->value('oldest')
                : $query()->min($ageColumn);
        } catch (\Throwable $e) {
            Log::warning('[admin-queue-alert] queue check failed', [
                'queue' => $key,
                'error' => $e->getMessage(),
            ]);

            return null;
        }

        $oldestAt = $oldest !== null ? Carbon::parse($oldest) : null;
        $ageMinutes = $oldestAt ? (int) round($oldestAt->diffInMinutes(now())) : 0;

        if ($ageMinutes < $thresholdMinutes) {
            return null;
        }

        return [
            'key' => $key,
            'label' => $label,
            'count' => $count,
            'oldest_human' => $oldestAt ? $oldestAt->diffForHumans() : 'unknown age',
            'age_minutes' => $ageMinutes,
            'threshold_label' => $thresholdLabel,
            'note' => $note,
        ];
    }
}
