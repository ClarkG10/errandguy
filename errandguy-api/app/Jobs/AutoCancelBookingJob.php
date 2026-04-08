<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\SystemConfig;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class AutoCancelBookingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public string $bookingId,
    ) {}

    public function handle(): void
    {
        $booking = Booking::find($this->bookingId);

        if (!$booking) {
            return;
        }

        // Only auto-cancel if still pending or no_runner
        if (!in_array($booking->status, ['pending', 'no_runner'])) {
            Log::info("AutoCancelBookingJob skipped: booking {$this->bookingId} status is {$booking->status}");
            return;
        }

        $timeoutMinutes = (int) SystemConfig::getValue('auto_cancel_timeout_minutes', '30');
        $createdMinutesAgo = $booking->created_at->diffInMinutes(now());

        if ($createdMinutesAgo < $timeoutMinutes) {
            // Re-dispatch with delay for remaining time
            $remainingSeconds = ($timeoutMinutes - $createdMinutesAgo) * 60;
            self::dispatch($this->bookingId)->delay(now()->addSeconds((int) $remainingSeconds));
            return;
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

        Log::info("Booking {$this->bookingId} auto-cancelled after {$timeoutMinutes} minutes");
    }
}
