<?php

namespace App\Console\Commands;

use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Services\NotificationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Nudge runners who started signing up and stopped.
 *
 * A runner registers, lands on the document-upload gate, and needs to find a
 * government ID and take a selfie — so a lot of them put the phone down
 * intending to come back. Nothing ever reminded them. The application sits at
 * `pending` with a missing document forever, the runner never earns a peso, and
 * the platform never gets the supply. Both sides lose to a task that was
 * genuinely just forgotten.
 *
 * Naming what is actually missing is the whole point — "finish your
 * application" is a chore, "add your government ID" is a two-minute task.
 *
 * Restraint is the other half. Three reminders, spaced at least two days, only
 * inside the first fortnight, and never for someone who has already submitted
 * everything and is waiting on US. A runner who hasn't finished in two weeks
 * will not be moved by a fourth push.
 *
 * History is read from the `notifications` rows this command itself writes
 * (indexed on `type`), not a cache flag: the cadence spans weeks, and a cache
 * eviction would restart the sequence and re-nudge someone who had already had
 * their three.
 */
class SendOnboardingRemindersCommand extends Command
{
    protected $signature = 'errandguy:send-onboarding-reminders
        {--limit=200 : Max runners nudged per run}
        {--dry-run : List who would be nudged without sending}';

    protected $description = 'Remind runners who left their application unfinished';

    /** The notification type, and the key this command reads its own history from. */
    private const TYPE = 'onboarding_reminder';

    /** Don't nudge before the runner has had a fair chance to finish unprompted. */
    private const FIRST_NUDGE_AFTER_HOURS = 20;

    /** Minimum gap between nudges. */
    private const MIN_GAP_HOURS = 48;

    /** Total nudges per runner, ever. */
    private const MAX_NUDGES = 3;

    /** Stop entirely past this age — the application is cold, not forgotten. */
    private const GIVE_UP_AFTER_DAYS = 14;

    /** Human labels for the required document types. */
    private const DOC_LABELS = [
        'government_id' => 'a government ID',
        'selfie' => 'a selfie',
    ];

    public function handle(NotificationService $notifications): int
    {
        $limit = max(1, (int) $this->option('limit'));
        $dryRun = (bool) $this->option('dry-run');

        $profiles = RunnerProfile::query()
            ->pending()
            // At least one required document still missing (or rejected and not
            // replaced). Its complement, readyForReview(), is waiting on an
            // ADMIN — nudging those would be blaming the runner for our queue.
            ->awaitingDocuments()
            ->whereHas('user', fn ($user) => $user
                // Current role is the honest signal of "I am trying to be a
                // runner". A profile can also be lazily created just by a
                // customer toggling to the runner tab and looking around; they
                // have not started an application and must not be pushed about
                // documents they never began.
                ->where('role', 'runner')
                ->where('status', 'active'))
            ->where('created_at', '<=', now()->subHours(self::FIRST_NUDGE_AFTER_HOURS))
            ->where('created_at', '>=', now()->subDays(self::GIVE_UP_AFTER_DAYS))
            ->with(['documents:id,runner_id,document_type,status'])
            // Oldest first: closest to ageing out of the window entirely.
            ->orderBy('created_at')
            ->limit($limit)
            ->get();

        if ($profiles->isEmpty()) {
            $this->info('No unfinished applications to nudge.');

            return self::SUCCESS;
        }

        $sent = 0;
        $skipped = 0;

        foreach ($profiles as $profile) {
            $history = Notification::query()
                ->where('user_id', $profile->user_id)
                ->where('type', self::TYPE)
                ->orderByDesc('created_at')
                ->get(['id', 'created_at']);

            if ($history->count() >= self::MAX_NUDGES) {
                $skipped++;

                continue;
            }

            $last = $history->first();
            if ($last && $last->created_at->gt(now()->subHours(self::MIN_GAP_HOURS))) {
                $skipped++;

                continue;
            }

            [$title, $body] = $this->copyFor($profile, $history->count());

            if ($dryRun) {
                $this->line("  would nudge {$profile->user_id} (#".($history->count() + 1)."): {$body}");

                continue;
            }

            try {
                // ONE delivery, typed for this command. The `type` in the data
                // bag becomes the persisted row's `type` column, which is both
                // what the app routes on (it maps `onboarding_reminder` to the
                // document screen, alongside `document_update`) and what this
                // command reads back as its cadence history. Sending under
                // `document_update` and writing a second row for the history
                // would put two entries in the runner's inbox for one nudge.
                $notifications->sendPush($profile->user_id, $title, $body, [
                    'type' => self::TYPE,
                    'nudge' => $history->count() + 1,
                ]);

                $sent++;
            } catch (\Throwable $e) {
                Log::warning('Onboarding reminder failed', [
                    'user_id' => $profile->user_id,
                    'error' => $e->getMessage(),
                ]);
                $skipped++;
            }
        }

        if ($dryRun) {
            $this->info('Dry run — nothing sent.');

            return self::SUCCESS;
        }

        $this->info("Nudged: {$sent}  Skipped: {$skipped}");

        return self::SUCCESS;
    }

    /**
     * Copy that names the missing thing. A rejected document is a different
     * message from one never uploaded — telling someone to "add" a document
     * they already sent reads as though we lost it.
     *
     * @return array{0: string, 1: string}
     */
    private function copyFor(RunnerProfile $profile, int $priorNudges): array
    {
        $onFile = $profile->documents
            ->where('status', '!=', 'rejected')
            ->pluck('document_type')
            ->all();
        $rejected = $profile->documents
            ->where('status', 'rejected')
            ->pluck('document_type')
            ->all();

        $missing = array_values(array_diff(RunnerProfile::REQUIRED_DOCUMENT_TYPES, $onFile));
        $labels = array_map(fn ($type) => self::DOC_LABELS[$type] ?? 'a document', $missing);

        // Anything missing that was previously REJECTED needs re-uploading, not
        // uploading — say so, and don't imply they never sent it.
        $needsReplacing = array_intersect($missing, $rejected) !== [];

        $what = match (count($labels)) {
            0 => 'your documents',
            1 => $labels[0],
            default => implode(' and ', $labels),
        };

        if ($needsReplacing) {
            return [
                'One document needs replacing',
                "We couldn’t accept {$what}. Upload a clearer photo and you’re good to go.",
            ];
        }

        // The last nudge says it is the last one — a reminder that keeps
        // arriving forever is worse than one that closes the loop honestly.
        if ($priorNudges + 1 >= self::MAX_NUDGES) {
            return [
                'Still want to earn with ErrandGuy?',
                "Add {$what} to finish signing up. This is our last reminder — you can pick it back up any time.",
            ];
        }

        return [
            'Finish signing up',
            "Add {$what} and we’ll review your application — it usually takes a day.",
        ];
    }
}
