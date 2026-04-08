<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\ErrandType;
use Illuminate\Support\Str;

class BookingService
{
    public function __construct(
        private PricingService $pricingService,
        private PromoService $promoService,
    ) {}

    /**
     * Generate a unique booking number in format EG-YYYYMMDD-XXXX.
     */
    public function generateBookingNumber(): string
    {
        do {
            $number = 'EG-' . now()->format('Ymd') . '-' . strtoupper(Str::random(4));
        } while (Booking::where('booking_number', $number)->exists());

        return $number;
    }

    /**
     * Generate a 4-digit ride PIN for transportation bookings.
     */
    public function generateRidePin(): string
    {
        return str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
    }

    /**
     * Log a booking status change.
     */
    public function logStatusChange(
        string $bookingId,
        string $status,
        ?string $changedBy = null,
        ?string $note = null,
        ?float $lat = null,
        ?float $lng = null
    ): BookingStatusLog {
        return BookingStatusLog::create([
            'booking_id' => $bookingId,
            'status' => $status,
            'changed_by' => $changedBy,
            'note' => $note,
            'lat' => $lat,
            'lng' => $lng,
        ]);
    }

    /**
     * Check if a booking can be cancelled based on current status.
     */
    public function isCancellable(Booking $booking): bool
    {
        return in_array($booking->status, ['pending', 'matched', 'accepted']);
    }

    /**
     * Duplicate a booking for rebooking.
     */
    public function rebook(Booking $original): Booking
    {
        $errandType = ErrandType::findOrFail($original->errand_type_id);
        $isTransportation = $errandType->slug === 'transportation';

        return Booking::create([
            'booking_number' => $this->generateBookingNumber(),
            'customer_id' => $original->customer_id,
            'errand_type_id' => $original->errand_type_id,
            'status' => 'pending',
            'pickup_address' => $original->pickup_address,
            'pickup_lat' => $original->pickup_lat,
            'pickup_lng' => $original->pickup_lng,
            'pickup_contact_name' => $original->pickup_contact_name,
            'pickup_contact_phone' => $original->pickup_contact_phone,
            'dropoff_address' => $original->dropoff_address,
            'dropoff_lat' => $original->dropoff_lat,
            'dropoff_lng' => $original->dropoff_lng,
            'dropoff_contact_name' => $original->dropoff_contact_name,
            'dropoff_contact_phone' => $original->dropoff_contact_phone,
            'description' => $original->description,
            'special_instructions' => $original->special_instructions,
            'estimated_item_value' => $original->estimated_item_value,
            'schedule_type' => 'now',
            'pricing_mode' => $original->pricing_mode,
            'vehicle_type_rate' => $original->vehicle_type_rate,
            'distance_km' => $original->distance_km,
            'base_fee' => $original->base_fee,
            'distance_fee' => $original->distance_fee,
            'service_fee' => $original->service_fee,
            'surcharge' => $original->surcharge,
            'total_amount' => $original->total_amount,
            'runner_payout' => $original->runner_payout,
            'is_transportation' => $isTransportation,
            'ride_pin' => $isTransportation ? $this->generateRidePin() : null,
        ]);
    }

    /**
     * Validate that a status transition is allowed.
     */
    public function isValidTransition(string $currentStatus, string $newStatus): bool
    {
        $transitions = [
            'pending' => ['matched', 'cancelled', 'no_runner'],
            'matched' => ['accepted', 'cancelled'],
            'accepted' => ['heading_to_pickup', 'cancelled'],
            'heading_to_pickup' => ['arrived_at_pickup', 'cancelled'],
            'arrived_at_pickup' => ['picked_up'],
            'picked_up' => ['in_transit'],
            'in_transit' => ['arrived_at_dropoff'],
            'arrived_at_dropoff' => ['delivered'],
            'delivered' => ['completed'],
        ];

        $allowed = $transitions[$currentStatus] ?? [];

        return in_array($newStatus, $allowed);
    }
}
