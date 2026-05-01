<?php

namespace App\Services;

use App\Models\ErrandType;
use App\Models\SystemConfig;

class PricingService
{
    /**
     * Per-vehicle base premium (PHP). Added on top of the errand type's
     * base fee so that vehicle choice meaningfully changes the quoted
     * price even on very short trips where distance_fee ≈ 0.
     *
     * Without this, walk/bicycle/motorcycle/car all collapse to the
     * same total at low distance, which made the vehicle selector look
     * broken to customers ("why are they all the same price?").
     *
     * Tuned to be ladderable but not punitive on short hops:
     *   walk        +0   (cheapest by design)
     *   bicycle    +10   (small premium for human-powered convenience)
     *   motorcycle +25   (default urban delivery vehicle)
     *   car        +60   (capacity / shelter premium)
     */
    private const VEHICLE_BASE_PREMIUM = [
        'walk' => 0,
        'bicycle' => 10,
        'motorcycle' => 25,
        'car' => 60,
    ];

    /**
     * Calculate price breakdown for a booking.
     *
     * Dropoff coordinates are optional: single-location errands (queue,
     * bills_payment) have no dropoff and the distance fee collapses to 0.
     */
    public function calculate(
        string $errandTypeId,
        float $pickupLat,
        float $pickupLng,
        ?float $dropoffLat,
        ?float $dropoffLng,
        string $vehicleType,
        string $scheduleType = 'now'
    ): array {
        $errandType = ErrandType::findOrFail($errandTypeId);
        $distanceKm = ($dropoffLat !== null && $dropoffLng !== null)
            ? $this->haversineDistance($pickupLat, $pickupLng, $dropoffLat, $dropoffLng)
            : 0.0;

        $baseFee = (float) $errandType->base_fee;
        $vehiclePremium = (float) (self::VEHICLE_BASE_PREMIUM[$vehicleType] ?? 0);
        $perKmRate = $this->getPerKmRate($errandType, $vehicleType);
        $distanceFee = round($distanceKm * $perKmRate, 2);

        $platformFeePercent = (float) SystemConfig::getValue('platform_fee_percent', '15');
        $subtotal = $baseFee + $vehiclePremium + $distanceFee;
        $serviceFee = round($subtotal * ($platformFeePercent / 100), 2);

        $surcharge = (float) $errandType->surcharge;

        // Customer pays gross + platform service fee.
        $totalAmount = round($subtotal + $serviceFee + $surcharge, 2);
        // Runner receives the gross (everything customer pays minus the
        // platform's service fee). Previous formula subtracted the fee
        // twice, shortchanging runners.
        $runnerPayout = round($totalAmount - $serviceFee, 2);

        return [
            'base_fee' => $baseFee,
            'vehicle_premium' => $vehiclePremium,
            'distance_km' => round($distanceKm, 2),
            'distance_fee' => $distanceFee,
            'service_fee' => $serviceFee,
            'surcharge' => $surcharge,
            'total_amount' => $totalAmount,
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
        ?float $dropoffLat,
        ?float $dropoffLng
    ): array {
        $errandType = ErrandType::find($errandTypeId);

        // Derive the supported vehicle list from the per-km rate columns
        // on the errand type itself. A vehicle is offered when its
        // per-km rate is non-zero \u2014 letting ops disable a mode for a
        // specific errand type purely from the database (no redeploy)
        // and keeping the previous hardcoded slug-based match in lockstep
        // with the seed data.
        $vehicleTypes = $this->supportedVehicleTypes($errandType);

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

        // Top-level metadata so the mobile app can show distance / time
        // badges and seed the negotiate slider without hunting through
        // each per-vehicle entry.
        $distanceKm = ($dropoffLat !== null && $dropoffLng !== null)
            ? round($this->haversineDistance($pickupLat, $pickupLng, $dropoffLat, $dropoffLng), 2)
            : 0.0;
        $estimates['distance_km'] = $distanceKm;
        if ($errandType) {
            $minNegotiate = (float) $errandType->min_negotiate_fee;
            $estimates['min_negotiate_fee'] = $minNegotiate;
            $estimates['vehicle_types'] = $vehicleTypes;

            // Suggested negotiate band for the mobile slider. Without
            // this the client falls back to a hard 500 PHP ceiling that
            // is much too low for car / long-distance jobs.
            //   recommended_min ≈ cheapest vehicle total
            //   recommended_max ≈ 3× the most expensive vehicle total,
            //                     floored at 1000 PHP for short hops.
            $totals = array_map(
                fn ($t) => (float) ($estimates[$t]['total_amount'] ?? 0),
                $vehicleTypes,
            );
            $maxTotal = empty($totals) ? 0 : max($totals);
            $minTotal = empty($totals) ? 0 : (min(array_filter($totals)) ?: $minNegotiate);
            $estimates['recommended_min'] = max($minNegotiate, round($minTotal, 2));
            $estimates['recommended_max'] = max(1000.0, round($maxTotal * 3, 2));
        }

        return $estimates;
    }

    /**
     * Vehicles available for a given errand type.
     *
     * Logic: a vehicle is offered iff its per-km column is > 0. This
     * matches how seed data is structured (transportation has 0 for walk
     * and bicycle, food has 0 for walk, etc.) and gives ops a single
     * row to flip without code changes.
     */
    private function supportedVehicleTypes(?ErrandType $errandType): array
    {
        if (!$errandType) {
            return ['walk', 'bicycle', 'motorcycle', 'car'];
        }

        $candidates = [
            'walk' => (float) $errandType->per_km_walk,
            'bicycle' => (float) $errandType->per_km_bicycle,
            'motorcycle' => (float) $errandType->per_km_motorcycle,
            'car' => (float) $errandType->per_km_car,
        ];

        $supported = array_keys(array_filter($candidates, fn ($rate) => $rate > 0));

        // Safety fallback: if config is misconfigured (all zeros), keep
        // the historical defaults so the customer can still get a quote.
        return empty($supported)
            ? ['walk', 'bicycle', 'motorcycle', 'car']
            : $supported;
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
