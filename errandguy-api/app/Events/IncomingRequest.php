<?php

namespace App\Events;

use App\Models\Booking;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcasts a just-matched booking to the runner's private stream — the
 * "you've got an offer" popup. Replaces the Supabase `bookings` UPDATE
 * subscription the runner app filtered by runner_id.
 *
 * SECURITY: the payload is an EXPLICIT non-participant offer projection — NOT
 * BookingResource. BookingResource gates contact/PIN fields on
 * `request()->user()`, which happens to be null here today only because the
 * broadcast is queued and runs in a worker; but MatchRunnerJob is dispatchSync'd
 * inside the customer's create request, so if this ever became ShouldBroadcastNow
 * (or the queue ran sync), BookingResource would see the CUSTOMER as the request
 * user and leak their contact details + the anti-fraud ride PIN to a runner who
 * has only been OFFERED the job. Building the payload by hand makes the
 * non-sensitive projection intrinsic to the offer, independent of ambient state.
 * Contact info, photos, receipts, signatures, the ride PIN and the customer
 * identity are all withheld until the runner accepts and fetches over REST.
 */
class IncomingRequest implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Booking $booking,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('runner.' . $this->booking->runner_id);
    }

    public function broadcastAs(): string
    {
        return 'booking.incoming';
    }

    public function broadcastWith(): array
    {
        $b = $this->booking->loadMissing('errandType');

        return [
            'id' => $b->id,
            'booking_number' => $b->booking_number,
            'status' => $b->status,
            'runner_id' => $b->runner_id,
            'errand_type_id' => $b->errand_type_id,
            'errand_type' => $b->errandType
                ? ['id' => $b->errandType->id, 'name' => $b->errandType->name, 'slug' => $b->errandType->slug]
                : null,
            // Locations are needed for the offer card / distance, but NOT the
            // contact name/phone at pickup or dropoff.
            'pickup_address' => $b->pickup_address,
            'pickup_lat' => $b->pickup_lat,
            'pickup_lng' => $b->pickup_lng,
            'dropoff_address' => $b->dropoff_address,
            'dropoff_lat' => $b->dropoff_lat,
            'dropoff_lng' => $b->dropoff_lng,
            'description' => $b->description,
            'distance_km' => $b->distance_km,
            'pricing_mode' => $b->pricing_mode,
            'base_fee' => $b->base_fee,
            'distance_fee' => $b->distance_fee,
            'service_fee' => $b->service_fee,
            'surcharge' => $b->surcharge,
            'total_amount' => $b->total_amount,
            'customer_offer' => $b->customer_offer,
            'runner_payout' => $b->runner_payout,
            'recommended_min' => $b->recommended_min,
            'recommended_max' => $b->recommended_max,
            'is_transportation' => $b->is_transportation,
            'schedule_type' => $b->schedule_type,
            'scheduled_at' => optional($b->scheduled_at)->toIso8601String(),
            'negotiate_expires_at' => optional($b->negotiate_expires_at)->toIso8601String(),
            'matched_at' => optional($b->matched_at)->toIso8601String(),
            'created_at' => optional($b->created_at)->toIso8601String(),
        ];
    }
}
