<?php

namespace App\Jobs;

use App\Events\BookingCancelled;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\SystemConfig;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
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
        $timeoutMinutes = (int) SystemConfig::getValue('auto_cancel_timeout_minutes', '30');

        // Decide + write under a row lock. Previously the status was read
        // unlocked and the cancel UPDATE had no status predicate, so a runner
        // who accepted in the window between the read and the write was
        // silently clobbered back to 'cancelled' (and, for a prepaid booking,
        // wrongly refunded). Re-reading FOR UPDATE and re-checking inside the
        // transaction lets a concurrent accept win — mirrors ExpireStaleMatchesJob.
        // The payment state as it stood UNDER THE LOCK, before this job's refund.
        // Only a 'paid' → 'refunded' move means THIS cancel returned the money —
        // a no_runner booking whose refund already ran in MatchRunnerJob arrives
        // here as 'refunded' and must not be told a second time. (A2)
        $paymentStatusBefore = null;

        $didCancel = DB::transaction(function () use ($timeoutMinutes, &$paymentStatusBefore) {
            $booking = Booking::whereKey($this->bookingId)->lockForUpdate()->first();

            if (!$booking) {
                return false;
            }

            // Only auto-cancel if STILL pending or no_runner (re-checked under lock).
            if (!in_array($booking->status, ['pending', 'no_runner'], true)) {
                Log::info("AutoCancelBookingJob skipped: booking {$this->bookingId} status is {$booking->status}");
                return false;
            }

            $createdMinutesAgo = $booking->created_at->diffInMinutes(now());
            if ($createdMinutesAgo < $timeoutMinutes) {
                // Not timed out yet — re-dispatch for the remaining window.
                $remainingSeconds = ($timeoutMinutes - $createdMinutesAgo) * 60;
                self::dispatch($this->bookingId)->delay(now()->addSeconds((int) $remainingSeconds));
                return false;
            }

            $paymentStatusBefore = $booking->payment_status;

            $booking->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancellation_reason' => 'Auto-cancelled: no runner found within timeout.',
            ]);

            BookingStatusLog::create([
                'booking_id' => $booking->id,
                'status' => 'cancelled',
                'changed_by' => null,
                'note' => "Auto-cancelled after {$timeoutMinutes} minutes with no runner",
            ]);

            return true;
        });

        // Only refund when we ACTUALLY cancelled (a closure `return` alone would
        // not skip this). Nobody was ever matched, so return any money collected
        // up front. refundUnfulfilled is idempotent and takes its own lock.
        if ($didCancel) {
            app(\App\Services\BookingService::class)
                ->refundUnfulfilled($this->bookingId, 'Auto-cancelled: no runner found within timeout');
            Log::info("Booking {$this->bookingId} auto-cancelled after {$timeoutMinutes} minutes");

            // Broadcast the cancellation so the customer's booking.{id} channel
            // drops them off the "finding a runner" screen live (+ the cancel
            // push). Under the old realtime path the WAL UPDATE propagated automatically;
            // now it must be explicit or the screen hangs until a manual refetch.
            $cancelled = Booking::find($this->bookingId);
            event(new BookingCancelled($cancelled));

            $this->notifyRefund($cancelled, $paymentStatusBefore);
        }

        return $didCancel;
    }

    /**
     * The BookingCancelled listener's customer push is deliberately cause-neutral
     * (it is shared with admin/platform cancels), so a PREPAID customer was told
     * only "your errand has been cancelled" — no reason, and no word that their
     * money had just been returned. Add one money notice on top, stating the
     * cause and the amount, and ONLY when this job's refund actually moved money:
     *   - cash / unpaid bookings collected nothing (refundUnfulfilled no-ops), and
     *   - a no_runner booking already refunded + notified by MatchRunnerJob
     *     arrives here as 'refunded', not 'paid'.
     * Cache flag makes a job retry after this point a no-op. (A2)
     */
    private function notifyRefund(?Booking $booking, ?string $paymentStatusBefore): void
    {
        if (! $booking || ! $booking->customer_id || $paymentStatusBefore !== 'paid') {
            return;
        }

        // Refund runs in its own transaction and can fail independently of the
        // cancel — only claim it once the row says it landed.
        if ($booking->fresh()->payment_status !== 'refunded') {
            return;
        }

        if (! Cache::add("booking-autocancel-refund-notified:{$booking->id}", true, 86400)) {
            return;
        }

        $number = $booking->booking_number ?? $booking->id;
        $amount = '₱'.number_format((float) $booking->total_amount, 2);

        SendPushJob::dispatch(
            $booking->customer_id,
            'Refund issued',
            "No runner was available for errand #{$number}, so we cancelled it and refunded {$amount} to your ErrandGuy wallet.",
            [
                'type' => 'payment',
                'booking_id' => $booking->id,
                'status' => 'cancelled',
                'reason' => 'auto_cancel_no_runner',
                'refund_amount' => round((float) $booking->total_amount, 2),
                'refunded_to' => 'wallet',
            ],
        );
    }
}
