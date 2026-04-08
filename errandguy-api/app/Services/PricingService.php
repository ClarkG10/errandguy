<?php

namespace App\Services;

use App\Models\ErrandType;
use App\Models\SystemConfig;

class PricingService
{
    /**
     * Calculate price breakdown for a booking.
     */
    public function calculate(
        string $errandTypeId,
        float $pickupLat,
        float $pickupLng,
        float $dropoffLat,
        float $dropoffLng,
        string $vehicleType,
        string $scheduleType = 'now'
    ): array {
        $errandType = ErrandType::findOrFail($errandTypeId);
        $distanceKm = $this->haversineDistance($pickupLat, $pickupLng, $dropoffLat, $dropoffLng);

        $baseFee = (float) $errandType->base_fee;
        $perKmRate = $this->getPerKmRate($errandType, $vehicleType);
        $distanceFee = round($distanceKm * $perKmRate, 2);

        $platformFeePercent = (float) SystemConfig::getValue('platform_fee_percent', '15');
        $subtotal = $baseFee + $distanceFee;
        $serviceFee = round($subtotal * ($platformFeePercent / 100), 2);

        $surcharge = (float) $errandType->surcharge;

        $totalAmount = $subtotal + $serviceFee + $surcharge;
        $runnerPayout = round($subtotal + $surcharge - $serviceFee, 2);

        return [
            'base_fee' => $baseFee,
            'distance_km' => round($distanceKm, 2),
            'distance_fee' => $distanceFee,
            'service_fee' => $serviceFee,
            'surcharge' => $surcharge,
            'total_amount' => round($totalAmount, 2),
            'runner_payout' => max(0, $runnerPayout),
            'vehicle_type' => $vehicleType,
        ];
    }

    /**
     * Estimate prices for all vehicle types.
     */
    public function estimate(
        string $errandTypeId,
        float $pickupLat,
        float $pickupLng,
        float $dropoffLat,
        float $dropoffLng
    ): array {
        $vehicleTypes = ['walk', 'bicycle', 'motorcycle', 'car'];
        $estimates = [];

        foreach ($vehicleTypes as $type) {
            $estimates[$type] = $this->calculate(
                $errandTypeId,
                $pickupLat,
                $pickupLng,
                $dropoffLat,
                $dropoffLng,
                $type
            );
        }

        return $estimates;
    }

    /**
     * Apply a promo discount to a subtotal.
     */
    public function applyPromo(float $subtotal, array $promo): array
    {
        if ($promo['discount_type'] === 'percentage') {
            $discount = round($subtotal * ($promo['discount_value'] / 100), 2);
        } else {
            $discount = (float) $promo['discount_value'];
        }

        // Enforce max discount cap
        if (!empty($promo['max_discount']) && $discount > (float) $promo['max_discount']) {
            $discount = (float) $promo['max_discount'];
        }

        $discount = min($discount, $subtotal); // Never discount more than subtotal

        return [
            'discount' => round($discount, 2),
            'discounted_total' => round($subtotal - $discount, 2),
        ];
    }

    /**
     * Calculate Haversine distance in kilometers.
     */
    private function haversineDistance(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadiusKm = 6371;

        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) * sin($dLat / 2)
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2))
            * sin($dLng / 2) * sin($dLng / 2);

        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadiusKm * $c;
    }

    private function getPerKmRate(ErrandType $errandType, string $vehicleType): float
    {
        return match ($vehicleType) {
            'walk' => (float) $errandType->per_km_walk,
            'bicycle' => (float) $errandType->per_km_bicycle,
            'motorcycle' => (float) $errandType->per_km_motorcycle,
            'car' => (float) $errandType->per_km_car,
            default => (float) $errandType->per_km_motorcycle,
        };
    }
}
