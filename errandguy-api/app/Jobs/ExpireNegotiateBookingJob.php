<?php

namespace App\Jobs;

use App\Events\BookingCancelled;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ExpireNegotiateBookingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public string $bookingId,
    ) {}

    /**
     * @return bool  true iff this call actually expired + refunded the booking.
     *               Read by ReapStrandedBookingsCommand to count recoveries
     *               (the queue ignores a job's return value). NOTE: this method
     *               does NOT check negotiate_expires_at — the timing gate is the
     *               delayed dispatch, so any caller invoking it directly (the
     *               reaper) MUST first confirm the window has elapsed.
     */
    public function handle(): bool
    {
        // Decide + write under a row lock so a runner who accepts the negotiate
        // broadcast in the race window wins instead of being clobbered back to
        // 'cancelled' (and, since negotiate bookings are charged up front,
        // wrongly refunded mid-errand). Mirrors ExpireStaleMatchesJob.
        $didCancel = DB::transaction(function () {
            $booking = Booking::whereKey($this->bookingId)->lockForUpdate()->first();

            // Only expire if STILL pending with no runner (re-checked under lock).
            if (!$booking || $booking->status !== 'pending' || $booking->runner_id !== null) {
                Log::info("ExpireNegotiateBookingJob skipped: booking {$this->bookingId} already progressed");
                return false;
            }

            $booking->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancellation_reason' => 'Negotiation period expired with no runner acceptance.',
            ]);

            BookingStatusLog::create([
                'booking_id' => $booking->id,
                'status' => 'cancelled',
                'changed_by' => null,
                'note' => 'Negotiate mode expired',
            ]);

            return true;
        });

        // Refund OUTSIDE the transaction (refundUnfulfilled takes its own lock)
        // and ONLY when we actually cancelled — an early skip means a runner
        // accepted, which must NOT be refunded. Negotiate bookings are charged
        // the offer up front (H11), so an unaccepted expiry returns that money.
        if ($didCancel) {
            app(\App\Services\BookingService::class)
                ->refundUnfulfilled($this->bookingId, 'Negotiation expired with no runner acceptance');
            Log::info("Negotiate booking {$this->bookingId} expired");

            // Broadcast so the negotiate customer's waiting screen learns the
            // offer expired (+ cancel push) instead of hanging on "finding a
            // runner" until a manual refetch.
            event(new BookingCancelled(Booking::find($this->bookingId)));
        }

        return $didCancel;
    }
}
