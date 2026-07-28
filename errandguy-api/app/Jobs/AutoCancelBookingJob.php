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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AutoCancelBookingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public string $bookingId,
    ) {}

    public function handle(): void
    {
        $timeoutMinutes = (int) SystemConfig::getValue('auto_cancel_timeout_minutes', '30');

        // Decide + write under a row lock. Previously the status was read
        // unlocked and the cancel UPDATE had no status predicate, so a runner
        // who accepted in the window between the read and the write was
        // silently clobbered back to 'cancelled' (and, for a prepaid booking,
        // wrongly refunded). Re-reading FOR UPDATE and re-checking inside the
        // transaction lets a concurrent accept win — mirrors ExpireStaleMatchesJob.
        $didCancel = DB::transaction(function () use ($timeoutMinutes) {
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
            // push). Under Supabase the WAL UPDATE propagated automatically;
            // now it must be explicit or the screen hangs until a manual refetch.
            event(new BookingCancelled(Booking::find($this->bookingId)));
        }
    }
}
