<?php

namespace App\Jobs;

use App\Events\BookingCancelled;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Services\BookingService;
use App\Support\CancellationNotice;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AutoCancelBookingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public string $bookingId,
    ) {}

    /**
     * @return bool  true iff this call actually cancelled + refunded the booking.
     *               (The queue ignores a job's return value; the wall-clock
     *               reaper — ReapStrandedBookingsCommand — reads it to count
     *               how many stranded bookings it recovered.)
     */
    public function handle(): bool
    {
        // Decide + write under a row lock. Previously the status was read
        // unlocked and the cancel UPDATE had no status predicate, so a runner
        // who accepted in the window between the read and the write was
        // silently clobbered back to 'cancelled' (and, for a prepaid booking,
        // wrongly refunded). Re-reading FOR UPDATE and re-checking inside the
        // transaction lets a concurrent accept win — mirrors ExpireStaleMatchesJob.
        $didCancel = DB::transaction(function () {
            $booking = Booking::whereKey($this->bookingId)->lockForUpdate()->first();

            if (!$booking) {
                return false;
            }

            // Only auto-cancel if STILL pending or no_runner (re-checked under lock).
            if (!in_array($booking->status, ['pending', 'no_runner'], true)) {
                Log::info("AutoCancelBookingJob skipped: booking {$this->bookingId} status is {$booking->status}");
                return false;
            }

            // A GCash/Maya errand still waiting for its payment has no search to
            // time out yet; its payment window ends it instead
            // (ExpireUnpaidBookingJob), with the right reason.
            if (BookingService::awaitingPayment($booking)) {
                Log::info("AutoCancelBookingJob skipped: booking {$this->bookingId} is waiting for its payment");
                return false;
            }

            // The same deadline the matching ladder searches until:
            // auto_cancel_timeout after matching started for an immediate
            // errand (so a slow payment doesn't eat the search), the end of the
            // matching window for a scheduled one. Cancelling a scheduled
            // errand earlier would kill it mid-search.
            $deadline = BookingService::matchingDeadline($booking);
            if (now()->lt($deadline)) {
                // Not timed out yet — re-dispatch for the remaining window.
                self::dispatch($this->bookingId)->delay($deadline);
                return false;
            }

            $booking->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancellation_reason' => 'Auto-cancelled: no runner found within timeout.',
            ]);

            BookingStatusLog::create([
                'booking_id' => $booking->id,
                'status' => 'cancelled',
                'changed_by' => null,
                'note' => 'Auto-cancelled: no runner found in time',
            ]);

            return true;
        });

        // Only refund when we ACTUALLY cancelled (a closure `return` alone would
        // not skip this). Nobody was ever matched, so return any money collected
        // up front. refundUnfulfilled is idempotent and takes its own lock.
        if ($didCancel) {
            app(BookingService::class)
                ->refundUnfulfilled($this->bookingId, 'Auto-cancelled: no runner found within timeout');
            Log::info("Booking {$this->bookingId} auto-cancelled: no runner found in time");

            // Broadcast the cancellation so the customer's booking.{id} channel
            // drops them off the "finding a runner" screen live, and push them
            // one notice that says why and where their money is: "…cancelled:
            // no runner was available. ₱X was returned to your ErrandGuy
            // wallet." (an unmatched errand refunded earlier by MatchRunnerJob
            // reads the same — the money is in the wallet either way).
            $cancelled = Booking::find($this->bookingId);
            event(new BookingCancelled(
                $cancelled,
                CancellationNotice::forCustomer($cancelled, CancellationNotice::NO_RUNNER),
            ));
        }

        return $didCancel;
    }
}
