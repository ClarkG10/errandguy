<?php

namespace App\Events;

use App\Models\Booking;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Fired when a booking is cancelled (customer- or admin-initiated). Keeps its
 * existing push-notification listener AND broadcasts to the booking channel,
 * under the SAME `booking.status` event name/shape as BookingStatusChanged so
 * the mobile app handles a cancellation through one code path — replacing the
 * old WAL update that used to surface the `cancelled` status live.
 */
class BookingCancelled implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Booking $booking,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('booking.' . $this->booking->id);
    }

    public function broadcastAs(): string
    {
        return 'booking.status';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->booking->id,
            'status' => $this->booking->status,
            'runner_id' => $this->booking->runner_id,
            'cancelled_at' => optional($this->booking->cancelled_at)->toIso8601String(),
            'cancellation_reason' => $this->booking->cancellation_reason,
        ];
    }
}
