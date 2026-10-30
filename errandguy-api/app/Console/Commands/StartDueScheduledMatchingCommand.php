<?php

namespace App\Console\Commands;

use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Services\BookingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Backstop for a scheduled errand whose matching never started.
 *
 * Booking creation queues ONE delayed MatchRunnerJob for 15 minutes before a
 * scheduled errand's time. If that job is lost (a queue flush, a worker that
 * was down when it came due, a crash before it was queued) nothing else ever
 * looks for a runner: the customer waits for a runner who was never searched
 * for, and only the auto-cancel refund ends it.
 *
 * This sweep finds a scheduled errand inside its matching window that is still
 * pending with no runner, no record of matching ever having started
 * (bookings.matching_started_at) and a grace period past the window opening, and
 * starts matching for it — exactly once: the booking is claimed with a
 * conditional update on matching_started_at, so overlapping runs (or a delayed
 * job arriving late) can't start it twice from here.
 *
 * The first search runs inline (the scheduler process), like an immediate
 * booking's search at creation, so it works even while the queue worker is the
 * thing that failed; the ladder's later sweeps go to the queue.
 */
class StartDueScheduledMatchingCommand extends Command
{
    protected $signature = 'errandguy:start-due-scheduled-matching';

    protected $description = 'Start matching for scheduled errands whose delayed matching task was lost.';

    /**
     * How long after the window opens before an errand counts as lost. The
     * delayed job should have run by then; this keeps the sweep from racing it.
     */
    private const GRACE_MINUTES = 2;

    private const MAX_PER_RUN = 200;

    public function handle(): int
    {
        $now = now();

        // Window opened at least GRACE ago (scheduled_at − lead ≤ now − grace)
        // and has not closed (scheduled_at + grace_after > now).
        $ids = Booking::where('schedule_type', 'scheduled')
            ->whereNotNull('scheduled_at')
            ->where('status', 'pending')
            ->whereNull('runner_id')
            ->whereNull('matching_started_at')
            // A negotiate-priced errand left open when that mode was retired is
            // ended (and refunded) by the stranded-booking reaper, not matched.
            ->where('pricing_mode', 'fixed')
            ->whereNotIn('payment_status', ['refunded', 'failed', 'expired'])
            ->where('scheduled_at', '<=', $now->copy()->addMinutes(BookingService::SCHEDULED_MATCH_LEAD_MINUTES - self::GRACE_MINUTES))
            ->where('scheduled_at', '>', $now->copy()->subMinutes(BookingService::SCHEDULED_MATCH_GRACE_MINUTES))
            ->orderBy('scheduled_at')
            ->limit(self::MAX_PER_RUN)
            ->pluck('id');

        $started = 0;
        foreach ($ids as $id) {
            $claimed = Booking::whereKey($id)
                ->where('status', 'pending')
                ->whereNull('matching_started_at')
                ->update(['matching_started_at' => now()]);

            if ($claimed !== 1) {
                continue;
            }

            $started++;
            Log::warning('Scheduled errand had no matching running; starting it now', ['booking_id' => $id]);

            try {
                MatchRunnerJob::dispatchSync($id);
            } catch (\Throwable $e) {
                // The inline search failed (deadlock, outage) — hand it to the
                // queue, which retries with backoff. The claim stands, so the
                // next run won't start a second one.
                Log::error('Scheduled matching rescue failed inline; queued instead', [
                    'booking_id' => $id,
                    'error' => $e->getMessage(),
                ]);
                MatchRunnerJob::dispatch($id);
            }
        }

        $this->info("Started matching for {$started} scheduled errand(s).");

        return self::SUCCESS;
    }
}
