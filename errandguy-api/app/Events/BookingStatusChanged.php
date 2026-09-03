<?php

namespace App\Events;

use App\Models\Booking;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Fired on every booking lifecycle transition. Two consumers:
 *  - queued listeners (push notifications, referral reward) — unchanged, and
 *  - the customer/runner mobile apps, via the broadcast below.
 *
 * Broadcasting replaces what the old realtime path used to deliver by tailing the
 * `bookings` table WAL. Every explicit dispatch site is meant to be post-commit,
 * so the queued broadcast reloads a persisted row — and `ShouldDispatchAfterCommit`
 * now ENFORCES that invariant: if any site dispatches while a DB transaction is
 * still open (as `RunnerErrandController::updateStatus` once did), the event is
 * held until commit instead of letting a queued listener — e.g. the referral
 * reward, which counts the referee's committed completed bookings — race a row
 * that isn't persisted yet and silently drop the reward.
 */
class BookingStatusChanged implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Booking $booking,
        public string $oldStatus,
        public string $newStatus,
    ) {}

    /**
     * Both participants subscribe to the booking's private channel — the
     * customer's tracking/confirm screens always, the runner once assigned.
     */
    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('booking.' . $this->booking->id);
    }

    public function broadcastAs(): string
    {
        return 'booking.status';
    }

    /**
     * Minimal, merge-safe payload. The mobile `useBookingStatus` hook reads
     * `status` and shallow-merges the rest into its cached booking; the
     * tracking screen then refetches the full booking over REST. So we ship
     * only lifecycle fields — never the participant-gated ones — with
     * timestamps ISO-8601 to match every other datetime the app receives.
     */
    public function broadcastWith(): array
    {
        return [
            'id' => $this->booking->id,
            'status' => $this->booking->status,
            'runner_id' => $this->booking->runner_id,
            'matched_at' => optional($this->booking->matched_at)->toIso8601String(),
            'accepted_at' => optional($this->booking->accepted_at)->toIso8601String(),
            'picked_up_at' => optional($this->booking->picked_up_at)->toIso8601String(),
            'completed_at' => optional($this->booking->completed_at)->toIso8601String(),
            'cancelled_at' => optional($this->booking->cancelled_at)->toIso8601String(),
            'cancellation_reason' => $this->booking->cancellation_reason,
        ];
    }
}
