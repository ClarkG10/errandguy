<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // If the viewer isn't yet a participant (e.g. an online runner
        // browsing the broadcast list before accepting), hide pickup /
        // dropoff contact phone + name so a runner can't harvest leads
        // by tapping "decline" on every job. Same for receipts /
        // signatures / item photos.
        $isParticipant = $this->isParticipant();
        $isAdmin = $request->user() instanceof \App\Models\AdminUser;
        $canSeeContacts = $isParticipant || $isAdmin;

        // Reviews are bidirectional (customer→runner AND runner→customer), so
        // a booking can hold two rows keyed by reviewer_id. Resolve them by
        // role from the loaded collection instead of the old ambiguous hasOne,
        // which returned an arbitrary single row once both parties had rated.
        $reviews = $this->relationLoaded('reviews') ? $this->reviews : null;
        $customerReview = $reviews?->firstWhere('reviewer_id', $this->customer_id);
        $runnerReview = $this->runner_id
            ? $reviews?->firstWhere('reviewer_id', $this->runner_id)
            : null;

        return [
            'id' => $this->id,
            'booking_number' => $this->booking_number,
            // Expose participant FKs so the mobile client can derive
            // ownership without an extra round-trip. Both are scoped by
            // the controller queries (runnerBookings / customerBookings)
            // so non-participants never see this resource.
            'customer_id' => $this->customer_id,
            'runner_id' => $this->runner_id,
            'errand_type_id' => $this->errand_type_id,
            'status' => $this->status,
            'errand_type' => $this->when(
                $this->relationLoaded('errandType'),
                fn () => new ErrandTypeResource($this->errandType),
            ),
            'runner' => $this->when(
                $this->relationLoaded('runner') && $this->runner,
                fn () => new UserResource($this->runner),
            ),
            'customer' => $this->when(
                $this->relationLoaded('customer') && $this->customer,
                fn () => new UserResource($this->customer),
            ),
            'pickup_address' => $this->pickup_address,
            'pickup_lat' => $this->pickup_lat,
            'pickup_lng' => $this->pickup_lng,
            'pickup_contact_name' => $this->when($canSeeContacts, $this->pickup_contact_name),
            'pickup_contact_phone' => $this->when($canSeeContacts, $this->pickup_contact_phone),
            'dropoff_address' => $this->dropoff_address,
            'dropoff_lat' => $this->dropoff_lat,
            'dropoff_lng' => $this->dropoff_lng,
            'dropoff_contact_name' => $this->when($canSeeContacts, $this->dropoff_contact_name),
            'dropoff_contact_phone' => $this->when($canSeeContacts, $this->dropoff_contact_phone),
            // Multi-stop: extra destinations after the primary dropoff. Contacts
            // follow the same non-participant masking as the dropoff contact.
            // Kept as [] (not omitted) when loaded-but-empty so the mobile
            // `stops: BookingStop[]` contract holds.
            'stops' => $this->when(
                $this->relationLoaded('stops'),
                fn () => $this->stops->map(fn ($stop) => [
                    'id' => $stop->id,
                    'sequence' => $stop->sequence,
                    'address' => $stop->address,
                    'lat' => $stop->lat,
                    'lng' => $stop->lng,
                    'contact_name' => $canSeeContacts ? $stop->contact_name : null,
                    'contact_phone' => $canSeeContacts ? $stop->contact_phone : null,
                    'note' => $stop->note,
                    'completed_at' => $stop->completed_at,
                ])->values(),
            ),
            'description' => $this->description,
            'special_instructions' => $this->special_instructions,
            // Customer-uploaded item photos can be documents / prescriptions /
            // IDs — hide them from a non-participant runner browsing the
            // negotiate broadcast (available()), as the comment above promises.
            // Kept as [] (not omitted) so the mobile `string[]` contract holds.
            'item_photos' => $this->when($canSeeContacts, $this->item_photos, []),
            'estimated_item_value' => $this->estimated_item_value,
            'shopping_budget' => $this->shopping_budget,
            // Itemized shopping checklist (array of {id,name,qty,checked,checked_at}).
            // Null-safe: the `array` cast yields null when no list was ever set.
            'shopping_items' => $this->shopping_items ?? [],
            'actual_item_cost' => $this->actual_item_cost,
            'receipt_photo_url' => $this->when($canSeeContacts, $this->receipt_photo_url),
            'schedule_type' => $this->schedule_type,
            'scheduled_at' => $this->scheduled_at,
            'pricing_mode' => $this->pricing_mode,
            'vehicle_type_rate' => $this->vehicle_type_rate,
            'distance_km' => $this->distance_km,
            'base_fee' => $this->base_fee,
            'distance_fee' => $this->distance_fee,
            'service_fee' => $this->service_fee,
            'surcharge' => $this->surcharge,
            'promo_discount' => $this->promo_discount,
            'total_amount' => $this->total_amount,
            'customer_offer' => $this->customer_offer,
            'runner_payout' => $this->runner_payout,
            'negotiate_expires_at' => $this->negotiate_expires_at,
            'is_transportation' => $this->is_transportation,
            // The ride PIN is the out-of-band secret the passenger (customer)
            // recites and the runner types at verify-pin. Disclosing it to the
            // runner via this resource would make that check security theatre,
            // so only the customer (and admins, for support) ever see it.
            'ride_pin' => $this->when(
                $this->is_transportation && ($request->user()?->id === $this->customer_id || $isAdmin),
                $this->ride_pin,
            ),
            'ride_pin_verified' => $this->ride_pin_verified,
            'pickup_photo_url' => $this->when($canSeeContacts, $this->pickup_photo_url),
            'delivery_photo_url' => $this->when($canSeeContacts, $this->delivery_photo_url),
            'signature_url' => $this->when($canSeeContacts, $this->signature_url),
            'matched_at' => $this->matched_at,
            'accepted_at' => $this->accepted_at,
            'picked_up_at' => $this->picked_up_at,
            'completed_at' => $this->completed_at,
            'cancelled_at' => $this->cancelled_at,
            'cancellation_reason' => $this->cancellation_reason,
            'cancellation_fee' => $this->cancellation_fee,
            'trip_share_active' => $this->trip_share_active,
            'trip_share_token' => $this->when(
                $this->trip_share_active && $this->isParticipant(),
                $this->trip_share_token,
            ),
            'status_logs' => $this->when(
                $this->relationLoaded('statusLogs'),
                fn () => $this->statusLogs->map(fn ($log) => [
                    'status' => $log->status,
                    'note' => $log->note,
                    'created_at' => $log->created_at,
                ]),
            ),
            'payment' => $this->when(
                $this->relationLoaded('payment') && $this->payment,
                fn () => [
                    'id' => $this->payment->id,
                    'amount' => $this->payment->amount,
                    'method' => $this->payment->method,
                    'status' => $this->payment->status,
                    'paid_at' => $this->payment->paid_at,
                ],
            ),
            // Back-compat: `review` has always meant "the customer's rating of
            // the runner" for existing clients, so keep it pointed there — now
            // resolved deterministically rather than by an unordered hasOne.
            'review' => $this->when(
                $customerReview !== null,
                fn () => new ReviewResource($customerReview),
            ),
            'customer_review' => $this->when(
                $customerReview !== null,
                fn () => new ReviewResource($customerReview),
            ),
            'runner_review' => $this->when(
                $runnerReview !== null,
                fn () => new ReviewResource($runnerReview),
            ),
            'reviews' => $this->when(
                $reviews !== null,
                fn () => ReviewResource::collection($reviews),
            ),
            'can_cancel' => in_array($this->status, ['pending', 'matched', 'accepted', 'heading_to_pickup']),
            'is_trackable' => in_array($this->status, ['accepted', 'heading_to_pickup', 'arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered']),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }

    /**
     * Check if the current authenticated user is a participant of this booking.
     */
    protected function isParticipant(): bool
    {
        $user = request()->user();
        if (!$user) {
            return false;
        }

        return $user->id === $this->customer_id || $user->id === $this->runner_id;
    }
}
