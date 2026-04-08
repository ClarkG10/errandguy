<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'booking_number' => $this->booking_number,
            'status' => $this->status,
            'errand_type' => $this->when(
                $this->relationLoaded('errandType'),
                fn () => new ErrandTypeResource($this->errandType),
            ),
            'runner' => $this->when(
                $this->relationLoaded('runner') && $this->runner,
                fn () => new UserResource($this->runner),
            ),
            'pickup_address' => $this->pickup_address,
            'pickup_lat' => $this->pickup_lat,
            'pickup_lng' => $this->pickup_lng,
            'pickup_contact_name' => $this->pickup_contact_name,
            'pickup_contact_phone' => $this->pickup_contact_phone,
            'dropoff_address' => $this->dropoff_address,
            'dropoff_lat' => $this->dropoff_lat,
            'dropoff_lng' => $this->dropoff_lng,
            'dropoff_contact_name' => $this->dropoff_contact_name,
            'dropoff_contact_phone' => $this->dropoff_contact_phone,
            'description' => $this->description,
            'special_instructions' => $this->special_instructions,
            'item_photos' => $this->item_photos,
            'estimated_item_value' => $this->estimated_item_value,
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
            'ride_pin' => $this->when(
                $this->is_transportation && $this->isParticipant(),
                $this->ride_pin,
            ),
            'ride_pin_verified' => $this->ride_pin_verified,
            'pickup_photo_url' => $this->pickup_photo_url,
            'delivery_photo_url' => $this->delivery_photo_url,
            'signature_url' => $this->signature_url,
            'matched_at' => $this->matched_at,
            'accepted_at' => $this->accepted_at,
            'picked_up_at' => $this->picked_up_at,
            'completed_at' => $this->completed_at,
            'cancelled_at' => $this->cancelled_at,
            'cancellation_reason' => $this->cancellation_reason,
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
            'review' => $this->when(
                $this->relationLoaded('review') && $this->review,
                fn () => new ReviewResource($this->review),
            ),
            'can_cancel' => in_array($this->status, ['pending', 'matched', 'accepted']),
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
