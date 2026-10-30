<?php

namespace App\Console\Commands;

use App\Jobs\AutoCancelBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Services\BookingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Starts matching for a scheduled errand whose window has opened and whose
 * search never began.
 *
 *   - A cash or wallet errand: booking creation queues ONE delayed
 *     MatchRunnerJob for 15 minutes before its time. If that job is lost (a
 *     queue flush, a worker that was down when it came due, a crash before it
 *     was queued) nothing else ever looks for a runner, so this sweep is its
 *     backstop, after a grace period past the window opening.
 *   - A paid GCash/Maya errand: no job is queued for it (matching waits for the
 *     payment, and the payment lands before the window opens), so this sweep
 *     is what starts it — as soon as the window opens, and with the no-runner
 *     auto-cancel armed for the window's end.
 *
 * An errand whose GCash/Maya payment hasn't arrived is never started here.
 * Each errand starts exactly once: it is claimed with a conditional update on
 * matching_started_at, so overlapping runs (or a delayed job arriving late)
 * can't start it twice from here.
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

        // Window has not closed (scheduled_at + grace_after > now) and opened
        // (scheduled_at − lead ≤ now) — at least GRACE ago for an errand whose
        // own delayed job should have started it.
        $windowOpen = $now->copy()->addMinutes(BookingService::SCHEDULED_MATCH_LEAD_MINUTES);
        $windowOpenPastGrace = $windowOpen->copy()->subMinutes(self::GRACE_MINUTES);

        $due = Booking::where('schedule_type', 'scheduled')
            ->whereNotNull('scheduled_at')
            ->where('status', 'pending')
            ->whereNull('runner_id')
            ->whereNull('matching_started_at')
            // A negotiate-priced errand left open when that mode was retired is
            // ended (and refunded) by the stranded-booking reaper, not matched.
            ->where('pricing_mode', 'fixed')
            ->whereNotIn('payment_status', ['refunded', 'failed', 'expired'])
            // Money before work: a GCash/Maya errand only once it is paid.
            ->where(fn ($q) => $q->where('payment_status', 'paid')
                ->orWhereNull('payment_method')
                ->orWhereIn('payment_method', ['cash', 'wallet']))
            ->where(fn ($q) => $q->where('scheduled_at', '<=', $windowOpenPastGrace)
                ->orWhere(fn ($paid) => $paid->paysOnline()->where('scheduled_at', '<=', $windowOpen)))
            ->where('scheduled_at', '>', $now->copy()->subMinutes(BookingService::SCHEDULED_MATCH_GRACE_MINUTES))
            ->orderBy('scheduled_at')
            ->limit(self::MAX_PER_RUN)
            ->get(['id', 'payment_method']);

        $started = 0;
        foreach ($due as $booking) {
            $id = $booking->id;
            $claimed = Booking::whereKey($id)
                ->where('status', 'pending')
                ->whereNull('matching_started_at')
                ->update(['matching_started_at' => now()]);

            if ($claimed !== 1) {
                continue;
            }

            $started++;

            if (BookingService::paysOnline($booking)) {
                // Its first search: nothing armed the no-runner auto-cancel yet.
                Log::info('Starting matching for a paid scheduled errand', ['booking_id' => $id]);
                AutoCancelBookingJob::dispatch($id)->delay(BookingService::matchingDeadline($booking->fresh()));
            } else {
                Log::warning('Scheduled errand had no matching running; starting it now', ['booking_id' => $id]);
            }

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
