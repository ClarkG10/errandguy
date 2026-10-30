<?php

namespace App\Console\Commands;

use App\Jobs\AutoCancelBookingJob;
use App\Models\Booking;
use App\Models\SystemConfig;
use App\Services\BookingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Wall-clock safety net for prepaid bookings whose money would otherwise stay
 * locked forever (SCALE-REL-1 / SCALE-REL-5).
 *
 * The normal auto-cancel path is a DELAYED queued job (AutoCancelBookingJob,
 * dispatched with ->delay() at the tail of BookingController::store). Two common
 * production failures leave it un-run:
 *   1. the queue worker is down / backed up when the delay fires, or the job
 *      row is lost — so a booking that never matched sits status=pending,
 *      payment_status=paid with the customer's money locked indefinitely; and
 *   2. a crash between Booking::create and the dispatch block (OOM, deploy
 *      restart mid-request) means no AutoCancelBookingJob is ever queued at all.
 *
 * This command is scheduled via Schedule::command (it runs INSIDE the scheduler
 * process, NOT on the queue worker), so it recovers those bookings even when the
 * worker is the thing that failed. It finds bookings whose auto-cancel window has
 * actually opened and runs the EXISTING AutoCancelBookingJob handle() for each —
 * which re-checks the status and the deadline under a row lock (so a runner who
 * just accepted wins) and refunds via the idempotent refundUnfulfilled, so this
 * can never double-refund or clobber a live booking, and re-running it is safe.
 *
 * The window that gates each booking is schedule-aware, so a booking is only
 * reaped once its matching deadline (BookingService::matchingDeadline) and the
 * auto-cancel timeout have both passed:
 *   - immediate: created_at + auto_cancel_timeout;
 *   - SCHEDULED: scheduled_at + the longer of auto_cancel_timeout and the
 *     matching grace (the search runs until after the scheduled time, so
 *     created_at is irrelevant — anchoring on it would wrongly cancel a valid
 *     future booking).
 * It covers every pricing mode: a negotiate-priced errand left open when that
 * mode was retired has no expiry job any more and is cancelled + refunded here
 * like any other unmatched errand.
 *
 * It ALSO recovers refund-failure orphans: the cancel jobs (and admin cancel)
 * commit the status→'cancelled' write and then refund in a SEPARATE
 * transaction, so a refund that throws after the cancel commits leaves
 * status='cancelled' + payment_status='paid'. Such a row is unambiguously a
 * missed FULL refund — the customer-cancel-with-fee path always moves
 * paid→'refunded', and nothing parks a live booking in cancelled+paid — so the
 * reaper re-runs the idempotent refundUnfulfilled to complete it. (This is the
 * safe alternative to restructuring those jobs into a single cancel+refund
 * transaction, which would change money-path lock ordering.)
 */
class ReapStrandedBookingsCommand extends Command
{
    protected $signature = 'errandguy:reap-stranded-bookings';

    protected $description = 'Cancel + refund prepaid bookings stranded past their auto-cancel window, independent of the delayed job (SCALE-REL-1/5).';

    /**
     * Max bookings to process per branch per run. The command exists for
     * prolonged worker outages, when the backlog can be large; bounding each
     * sweep keeps memory flat and the run under the 5-minute cadence. The oldest
     * are taken first and the next scheduled run continues where this left off.
     */
    private const MAX_PER_RUN = 500;

    public function handle(): int
    {
        $reaped = 0;
        $checked = 0;
        $errors = 0;

        // ── Unmatched bookings: backstop AutoCancelBookingJob ──
        // Still awaiting a runner (the exact statuses AutoCancelBookingJob acts
        // on) AND past their auto-cancel window. handle() re-locks + re-checks
        // status and deadline, so a runner mid-accept still wins.
        $timeoutMinutes = (int) SystemConfig::getValue('auto_cancel_timeout_minutes', '30');
        $immediateCutoff = now()->subMinutes($timeoutMinutes);
        $scheduledCutoff = now()->subMinutes(max($timeoutMinutes, BookingService::SCHEDULED_MATCH_GRACE_MINUTES));
        $pendingIds = Booking::whereIn('status', ['pending', 'no_runner'])
            ->where(fn ($q) => $this->scheduleAwareWindow($q, $immediateCutoff, $scheduledCutoff))
            ->orderBy('created_at')
            ->limit(self::MAX_PER_RUN)
            ->pluck('id');
        $checked += $pendingIds->count();
        foreach ($pendingIds as $id) {
            try {
                if ((new AutoCancelBookingJob($id))->handle()) {
                    $reaped++;
                }
            } catch (\Throwable $e) {
                $errors++;
                Log::error('ReapStrandedBookingsCommand: failed to reap unmatched booking', [
                    'booking_id' => $id, 'error' => $e->getMessage(),
                ]);
            }
        }

        // ── Refund-failure orphans: cancelled but still 'paid' ──
        // The cancel jobs (and admin cancel) commit status→'cancelled'
        // and then refund in a SEPARATE transaction; if that refund throws after
        // the cancel commits, the booking is left status='cancelled' +
        // payment_status='paid'. That state is UNAMBIGUOUS: the customer-cancel
        // -with-fee path always moves paid→'refunded' (BookingController::cancel),
        // and no path parks a live booking in cancelled+paid — so this is only
        // ever a missed FULL refund. refundUnfulfilled is idempotent + row-locked,
        // so completing it here cannot double-refund; the small grace avoids
        // racing a refund that is about to run in the originating job.
        $orphanIds = Booking::where('status', 'cancelled')
            ->where('payment_status', 'paid')
            ->where(function ($q) {
                $q->whereNull('cancelled_at')
                    ->orWhere('cancelled_at', '<', now()->subMinutes(2));
            })
            ->orderBy('cancelled_at')
            ->limit(self::MAX_PER_RUN)
            ->pluck('id');
        $checked += $orphanIds->count();
        foreach ($orphanIds as $id) {
            try {
                app(\App\Services\BookingService::class)->refundUnfulfilled(
                    $id,
                    'Reaper: completing a refund that failed after the booking was already cancelled',
                );
                // refundUnfulfilled is void; it flips payment_status to 'refunded'
                // on success, so re-read to count only genuine recoveries.
                if (Booking::whereKey($id)->value('payment_status') === 'refunded') {
                    $reaped++;
                }
            } catch (\Throwable $e) {
                $errors++;
                Log::error('ReapStrandedBookingsCommand: failed to recover refund-orphan booking', [
                    'booking_id' => $id, 'error' => $e->getMessage(),
                ]);
            }
        }

        if ($reaped > 0) {
            // WARNING, not INFO: a non-zero reap means the primary delayed-job
            // path did NOT run for these — a worker/scheduler gap worth noticing.
            Log::warning("ReapStrandedBookingsCommand recovered {$reaped} stranded booking(s) whose delayed cancel/refund did not run.");
        }

        $this->info("Reaped {$reaped} stranded booking(s) (checked {$checked}, errors {$errors}).");

        // Non-zero exit if any booking threw, so a systemic failure of the
        // money-safety backstop itself surfaces to the scheduler/monitoring
        // instead of silently exiting 0.
        return $errors > 0 ? self::FAILURE : self::SUCCESS;
    }

    /**
     * Constrain a query to bookings whose primary delayed job would already have
     * fired, using the SAME anchor store() chose (BookingService::isScheduled):
     * scheduled bookings age from scheduled_at, everything else (immediate —
     * including a stray scheduled_at on a 'now' booking, or a 'scheduled' row
     * missing scheduled_at) ages from created_at. Keying on schedule_type rather
     * than scheduled_at nullness means a malformed 'now'+scheduled_at booking
     * can't mis-anchor onto a far-future date.
     *
     * @param  \Illuminate\Database\Eloquent\Builder  $query
     */
    private function scheduleAwareWindow($query, \DateTimeInterface $immediateCutoff, \DateTimeInterface $scheduledCutoff)
    {
        return $query->where(function ($q) use ($immediateCutoff, $scheduledCutoff) {
            $q->where(function ($deferred) use ($scheduledCutoff) {
                $deferred->where('schedule_type', 'scheduled')
                    ->whereNotNull('scheduled_at')
                    ->where('scheduled_at', '<', $scheduledCutoff);
            })->orWhere(function ($immediate) use ($immediateCutoff) {
                $immediate->where(function ($w) {
                    $w->where('schedule_type', '!=', 'scheduled')
                        ->orWhereNull('scheduled_at');
                })->where('created_at', '<', $immediateCutoff);
            });
        });
    }
}
