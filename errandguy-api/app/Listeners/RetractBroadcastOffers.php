<?php

namespace App\Listeners;

use App\Events\BookingCancelled;
use App\Events\BookingStatusChanged;
use App\Jobs\RetractOfferJob;
use App\Models\Booking;

/**
 * Withdraws the broadcast offer cards for an errand the moment it stops being
 * claimable, so losing runners' inboxes don't fill with dead offers.
 *
 * Both entry points are auto-discovered by their event type-hint (see the note
 * in AppServiceProvider — listeners are NOT registered explicitly). Firing
 * twice for one booking is harmless: {@see RetractOfferJob} no-ops once the
 * rows are gone.
 */
class RetractBroadcastOffers
{
    /**
     * An errand left `pending` — most often because a runner accepted it. The
     * winner keeps their card; everyone else loses theirs.
     */
    public function handle(BookingStatusChanged $event): void
    {
        $booking = $event->booking;

        if ($event->newStatus === 'pending' || ! $this->wasBroadcast($booking)) {
            return;
        }

        RetractOfferJob::dispatch(
            $booking->id,
            $booking->runner_id,
            $booking->runner_id ? 'taken' : 'cancelled',
        );
    }

    /**
     * Cancellations and negotiate-window expiry both arrive here
     * (ExpireNegotiateBookingJob fires BookingCancelled). Nobody won, so every
     * card goes.
     */
    public function handleCancelled(BookingCancelled $event): void
    {
        $booking = $event->booking;

        if (! $this->wasBroadcast($booking)) {
            return;
        }

        RetractOfferJob::dispatch($booking->id, null, 'cancelled');
    }

    /**
     * Only negotiate-mode bookings are fanned out to nearby runners as
     * `incoming_request` cards (BroadcastToRunnersJob); a fixed-mode match
     * offers a single runner and needs no retraction sweep.
     */
    private function wasBroadcast(?Booking $booking): bool
    {
        return $booking !== null && $booking->pricing_mode === 'negotiate';
    }
}
