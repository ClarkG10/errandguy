<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Tells one runner that a broadcast errand offer is no longer claimable —
 * someone else took it, it expired, or the customer cancelled.
 *
 * Rides the SAME private stream the offer arrived on (`notifications.{userId}`,
 * see {@see NotificationCreated}) so the app needs no new subscription: the
 * open offer card or modal can dismiss itself the moment the errand is gone,
 * instead of the runner tapping accept and being told BOOKING_STALE.
 */
class OfferWithdrawn implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $userId,
        public string $bookingId,
        /** 'taken' | 'expired' | 'cancelled' — lets the app word the dismissal. */
        public string $reason,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('notifications.'.$this->userId);
    }

    public function broadcastAs(): string
    {
        return 'offer.withdrawn';
    }

    public function broadcastWith(): array
    {
        return [
            'booking_id' => $this->bookingId,
            'reason' => $this->reason,
        ];
    }
}
