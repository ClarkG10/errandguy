<?php

namespace App\Console\Commands;

use App\Jobs\AutoCancelBookingJob;
use App\Jobs\ExpireNegotiateBookingJob;
use App\Models\Booking;
use App\Models\SystemConfig;
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
 * actually opened and runs the EXISTING AutoCancelBookingJob / ExpireNegotiateBookingJob
 * handle() for each — those methods re-check the status under a row lock (so a
 * runner who just accepted wins) and refund via the idempotent refundUnfulfilled,
 * so this can never double-refund or clobber a live booking, and re-running it is
 * safe.
 *
 * The window that gates each booking is mode- AND schedule-aware, so a booking is
 * only reaped once the SAME instant its primary delayed job would have fired has
 * passed:
 *   - immediate fixed: created_at + auto_cancel_timeout;
 *   - SCHEDULED fixed: scheduled_at + auto_cancel_timeout (the primary job is
 *     delayed to ~scheduled_at, so created_at is irrelevant — anchoring on it
 *     would wrongly cancel a valid future booking);
 *   - negotiate (immediate or scheduled): negotiate_expires_at, which the
 *     booking already carries and which is correctly in the future for a
 *     scheduled offer; a crash orphan whose negotiate_expires_at was never
 *     written falls back to the same schedule-aware created_at/scheduled_at
 *     anchor so it is still recovered.
 *
 * Known limitation (pre-existing, not introduced here): AutoCancelBookingJob /
 * ExpireNegotiateBookingJob commit the status→'cancelled' write and then refund
 * in a SEPARATE transaction. If that refund throws after the cancel commits, the
 * booking is left status='cancelled' + payment_status='paid' and is NOT
 * re-selected by this reaper (it only sweeps still-awaiting-a-runner statuses).
 * Closing that fully needs an atomic cancel+refund in those jobs.
 */
class ReapStrandedBookingsCommand extends Command
{
    protected $signature = 'errandguy:reap-stranded-bookings';

    protected $description = 'Cancel + refund prepaid bookings stranded past their auto-cancel/negotiate window, independent of the delayed job (SCALE-REL-1/5).';

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

        // ── Fixed-price bookings: backstop AutoCancelBookingJob ──
        // Still awaiting a runner (the exact statuses AutoCancelBookingJob acts
        // on) AND past their auto-cancel window. handle() re-locks + re-checks
        // status and age, so a runner mid-accept still wins.
        $timeoutMinutes = (int) SystemConfig::getValue('auto_cancel_timeout_minutes', '30');
        $fixedCutoff = now()->subMinutes($timeoutMinutes);
        $fixedIds = Booking::where('pricing_mode', 'fixed')
            ->whereIn('status', ['pending', 'no_runner'])
            ->where(fn ($q) => $this->scheduleAwareWindow($q, $fixedCutoff))
            ->orderBy('created_at')
            ->limit(self::MAX_PER_RUN)
            ->pluck('id');
        $checked += $fixedIds->count();
        foreach ($fixedIds as $id) {
            try {
                if ((new AutoCancelBookingJob($id))->handle()) {
                    $reaped++;
                }
            } catch (\Throwable $e) {
                $errors++;
                Log::error('ReapStrandedBookingsCommand: failed to reap fixed booking', [
                    'booking_id' => $id, 'error' => $e->getMessage(),
                ]);
            }
        }

        // ── Negotiate bookings: backstop ExpireNegotiateBookingJob ──
        // A DIFFERENT recovery path gated on negotiate_expires_at — NOT the
        // auto-cancel timeout. ExpireNegotiateBookingJob::handle() does NOT
        // self-check that window, so we only invoke it once the window has
        // elapsed (a SCHEDULED negotiate offer's window is correctly in the
        // future, so it is skipped until it actually opens and closes).
        $negotiateIds = Booking::where('pricing_mode', 'negotiate')
            ->where('status', 'pending')
            ->whereNull('runner_id')
            ->where(function ($q) use ($fixedCutoff) {
                // Normal: the offer window has elapsed.
                $q->where(function ($expired) {
                    $expired->whereNotNull('negotiate_expires_at')
                        ->where('negotiate_expires_at', '<', now());
                })
                // Crash orphan: negotiate_expires_at was never written (a crash
                // between the up-front charge and store() setting it, so the
                // delayed ExpireNegotiateBookingJob was never dispatched either).
                // Recover via the same schedule-aware anchor with the auto-cancel
                // window as a grace — far longer than any real negotiate window,
                // so a live offer is never hit; only a genuine orphan is.
                ->orWhere(function ($orphan) use ($fixedCutoff) {
                    $orphan->whereNull('negotiate_expires_at');
                    $this->scheduleAwareWindow($orphan, $fixedCutoff);
                });
            })
            ->orderBy('created_at')
            ->limit(self::MAX_PER_RUN)
            ->pluck('id');
        $checked += $negotiateIds->count();
        foreach ($negotiateIds as $id) {
            try {
                if ((new ExpireNegotiateBookingJob($id))->handle()) {
                    $reaped++;
                }
            } catch (\Throwable $e) {
                $errors++;
                Log::error('ReapStrandedBookingsCommand: failed to reap negotiate booking', [
                    'booking_id' => $id, 'error' => $e->getMessage(),
                ]);
            }
        }

        if ($reaped > 0) {
            // WARNING, not INFO: a non-zero reap means the primary delayed-job
            // path did NOT run for these — a worker/scheduler gap worth noticing.
            Log::warning("ReapStrandedBookingsCommand recovered {$reaped} stranded booking(s) whose delayed cancel/expire job did not run.");
        }

        $this->info("Reaped {$reaped} stranded booking(s) (checked {$checked}, errors {$errors}).");

        // Non-zero exit if any booking threw, so a systemic failure of the
        // money-safety backstop itself surfaces to the scheduler/monitoring
        // instead of silently exiting 0.
        return $errors > 0 ? self::FAILURE : self::SUCCESS;
    }

    /**
     * Constrain a query to bookings whose primary delayed job would already have
     * fired, using the SAME anchor store() chose (its $isScheduled = schedule_type
     * === 'scheduled' && scheduled_at set): scheduled bookings age from
     * scheduled_at, everything else (immediate — including a stray scheduled_at on
     * a 'now' booking, or a 'scheduled' row missing scheduled_at) ages from
     * created_at. Keying on schedule_type rather than scheduled_at nullness means a
     * malformed 'now'+scheduled_at booking can't mis-anchor onto a far-future date.
     *
     * @param  \Illuminate\Database\Eloquent\Builder  $query
     */
    private function scheduleAwareWindow($query, \DateTimeInterface $cutoff)
    {
        return $query->where(function ($q) use ($cutoff) {
            $q->where(function ($deferred) use ($cutoff) {
                $deferred->where('schedule_type', 'scheduled')
                    ->whereNotNull('scheduled_at')
                    ->where('scheduled_at', '<', $cutoff);
            })->orWhere(function ($immediate) use ($cutoff) {
                $immediate->where(function ($w) {
                    $w->where('schedule_type', '!=', 'scheduled')
                        ->orWhereNull('scheduled_at');
                })->where('created_at', '<', $cutoff);
            });
        });
    }
}
