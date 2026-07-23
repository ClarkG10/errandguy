<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ExpireNegotiateBookingJob implements ShouldQueue
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

        // Only expire if still pending (no runner accepted)
        if ($booking->status !== 'pending' || $booking->runner_id !== null) {
            Log::info("ExpireNegotiateBookingJob skipped: booking {$this->bookingId} already progressed");
            return;
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

        // A negotiate booking is charged the customer's offer up front (H11), so
        // an expiry with no runner acceptance must return that money — same
        // "unfulfilled paid booking" rule as the no-runner / auto-cancel paths.
        app(\App\Services\BookingService::class)
            ->refundUnfulfilled($this->bookingId, 'Negotiation expired with no runner acceptance');

        Log::info("Negotiate booking {$this->bookingId} expired");
    }
}
