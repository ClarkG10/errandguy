<?php

namespace App\Events;

use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Services\BookingService;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;

/**
 * Broadcasts a just-matched booking to the runner's private stream — the
 * "you've got an offer" popup. Replaces the old `bookings` UPDATE
 * subscription the runner app filtered by runner_id.
 *
 * SECURITY: the payload is an EXPLICIT non-participant offer projection — NOT
 * BookingResource. BookingResource gates contact fields on
 * `request()->user()`, which happens to be null here today only because the
 * broadcast is queued and runs in a worker; but MatchRunnerJob is dispatchSync'd
 * inside the customer's create request, so if this ever became ShouldBroadcastNow
 * (or the queue ran sync), BookingResource would see the CUSTOMER as the request
 * user and leak their contact details to a runner who has only been OFFERED the
 * job. Building the payload by hand makes the non-sensitive projection intrinsic
 * to the offer, independent of ambient state. Contact info, photos, receipts,
 * signatures and the customer identity are all withheld until the runner
 * accepts and fetches over REST.
 */
class IncomingRequest implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Booking $booking,
        /**
         * Straight-line km from the runner to the pickup, as matching measured
         * it (the same figure the offer push carries). Null when unknown.
         */
        public ?float $distanceToPickupKm = null,
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
        $b = $this->booking->loadMissing(['errandType', 'stops']);

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
            // Trimmed: a "Buy for me" list can run to ~10,000 characters and
            // Reverb refuses a message over 10 KB (the offer would silently
            // never arrive). The offer card shows three lines of it; the
            // errand screen fetches the full text after accepting.
            'description' => $b->description !== null ? Str::limit($b->description, 500) : null,
            'special_instructions' => $b->special_instructions,
            // Extra drop-offs on a multi-stop errand: where, in order, and the
            // customer's note — never the contact at each stop (the same
            // withholding as pickup/dropoff above).
            'stops' => $b->stops->map(fn ($stop) => [
                'id' => $stop->id,
                'sequence' => $stop->sequence,
                'address' => $stop->address,
                'lat' => $stop->lat,
                'lng' => $stop->lng,
                'note' => $stop->note,
            ])->values()->all(),
            'distance_km' => $b->distance_km,
            // The vehicle the customer paid for. Matching only offers an errand
            // to a runner whose vehicle can serve it, but the runner should
            // still see what the job needs before accepting.
            'vehicle_type' => $b->vehicle_type_rate,
            'pricing_mode' => $b->pricing_mode,
            'base_fee' => $b->base_fee,
            'distance_fee' => $b->distance_fee,
            'service_fee' => $b->service_fee,
            'surcharge' => $b->surcharge,
            'total_amount' => $b->total_amount,
            'runner_payout' => $b->runner_payout,
            // "Buy for me": the runner fronts the item money (repaid in cash at
            // the door), so the ceiling has to be on the offer they decide
            // from — not only on the REST payload that upgrades it seconds
            // later. Null for every other type.
            'shopping_budget' => $b->shopping_budget,
            // How the job settles (cash / wallet / gcash / maya) — the method
            // TYPE string only, never a gateway reference. Same value
            // BookingResource sends runners as payment_method_type.
            'payment_method_type' => $b->payment_method,
            // Cash to take at the door (fare on a cash errand, plus reported
            // item money), or null — the same figure BookingResource sends.
            'amount_to_collect' => BookingResource::amountToCollectFor($b),
            // The offer's real countdown and pickup distance, which the push
            // already carried; the realtime popup fell back to a 30-second
            // guess and no distance until its REST upgrade landed.
            'accept_deadline' => BookingService::matchAcceptDeadline($b->matched_at),
            // `??`: an offer queued before this property existed unserializes
            // without it, and reading an unset typed property throws — the
            // runner would lose the offer popup across a deploy.
            'distance_to_pickup_km' => $this->distanceToPickupKm ?? null,
            'schedule_type' => $b->schedule_type,
            'scheduled_at' => optional($b->scheduled_at)->toIso8601String(),
            'matched_at' => optional($b->matched_at)->toIso8601String(),
            'created_at' => optional($b->created_at)->toIso8601String(),
        ];
    }
}
