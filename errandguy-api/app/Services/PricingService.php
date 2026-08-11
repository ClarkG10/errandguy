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
    /**
     * @param  list<array{lat:float|int|string,lng:float|int|string}>  $extraStops
     *   Ordered EXTRA destinations after the primary dropoff (multi-stop). Each
     *   adds a leg to the route distance + a flat per-stop fee. Empty for an
     *   ordinary single-dropoff booking.
     */
    public function calculate(
        string $errandTypeId,
        float $pickupLat,
        float $pickupLng,
        ?float $dropoffLat,
        ?float $dropoffLng,
        string $vehicleType,
        string $scheduleType = 'now',
        array $extraStops = []
    ): array {
        $errandType = ErrandType::findOrFail($errandTypeId);
        $extraStops = $this->sanitizeStops($extraStops);
        $distanceKm = ($dropoffLat !== null && $dropoffLng !== null)
            ? $this->routeDistanceKm($pickupLat, $pickupLng, $dropoffLat, $dropoffLng, $extraStops)
            : 0.0;

        $baseFee = (float) $errandType->base_fee;
        $vehiclePremium = (float) (self::VEHICLE_BASE_PREMIUM[$vehicleType] ?? 0);
        $perKmRate = $this->getPerKmRate($errandType, $vehicleType);
        $distanceFee = round($distanceKm * $perKmRate, 2);

        $platformFeePercent = (float) SystemConfig::getValue('platform_fee_percent', '15');
        $subtotal = $baseFee + $vehiclePremium + $distanceFee;
        $serviceFee = round($subtotal * ($platformFeePercent / 100), 2);

        // Each EXTRA stop (beyond the primary dropoff) adds a flat fee on top of
        // the base surcharge. It flows into the runner's payout (payout = total −
        // service fee), compensating the extra handling the multi-leg distance
        // alone doesn't capture. Tunable via SystemConfig without a redeploy.
        $stopsFee = round(count($extraStops) * (float) SystemConfig::getValue('multi_stop_fee', '15'), 2);
        $surcharge = (float) $errandType->surcharge + $stopsFee;

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
            'surcharge' => round($surcharge, 2),
            'stops_fee' => $stopsFee,
            'stops_count' => count($extraStops),
            'total_amount' => $totalAmount,
            'runner_payout' => max(0, $runnerPayout),
            'vehicle_type' => $vehicleType,
        ];
    }

    /**
     * Apply a negotiate-mode customer offer to a computed fixed-price
     * breakdown.
     *
     * Product policy (confirmed): the customer's OFFER is the total they pay,
     * and the platform still takes its FLAT computed service fee (the same fee
     * the standard distance/vehicle calc produced) — the offer only changes the
     * runner's share. The component fees (base/distance/vehicle/surcharge) are
     * kept for reference/records but no longer sum to the total, since the
     * offer overrides it.
     *
     * Without this, negotiate bookings were priced at the fixed fare and the
     * customer_offer was cosmetic (stored + shown to runners but never charged).
     *
     * @param  array<string,mixed>  $pricing  a calculate() result
     * @return array<string,mixed>
     */
    public function applyNegotiateOffer(array $pricing, float $offer): array
    {
        $offer = round($offer, 2);
        $pricing['total_amount'] = $offer;
        $pricing['runner_payout'] = max(0, round($offer - (float) $pricing['service_fee'], 2));

        return $pricing;
    }

    /**
     * Estimate prices for all vehicle types.
     */
    /**
     * @param  list<array{lat:float|int|string,lng:float|int|string}>  $extraStops
     *   Multi-stop extra destinations (see {@see self::calculate()}).
     */
    public function estimate(
        string $errandTypeId,
        float $pickupLat,
        float $pickupLng,
        ?float $dropoffLat,
        ?float $dropoffLng,
        array $extraStops = []
    ): array {
        $errandType = ErrandType::find($errandTypeId);
        $extraStops = $this->sanitizeStops($extraStops);

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
                $type,
                extraStops: $extraStops,
            );
        }

        // Top-level metadata so the mobile app can show distance / time
        // badges and seed the negotiate slider without hunting through
        // each per-vehicle entry.
        $distanceKm = ($dropoffLat !== null && $dropoffLng !== null)
            ? round($this->routeDistanceKm($pickupLat, $pickupLng, $dropoffLat, $dropoffLng, $extraStops), 2)
            : 0.0;
        $estimates['distance_km'] = $distanceKm;
        $estimates['stops_count'] = count($extraStops);
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

    /**
     * Total route distance in km for pickup → dropoff → each extra stop, summing
     * the straight-line (Haversine) length of every consecutive leg. With no
     * extra stops this equals the plain pickup→dropoff distance, so single-stop
     * bookings price exactly as before.
     *
     * @param  list<array{lat:float,lng:float}>  $extraStops  Already sanitized.
     */
    private function routeDistanceKm(
        float $pickupLat,
        float $pickupLng,
        float $dropoffLat,
        float $dropoffLng,
        array $extraStops
    ): float {
        $total = $this->haversineDistance($pickupLat, $pickupLng, $dropoffLat, $dropoffLng);

        $prevLat = $dropoffLat;
        $prevLng = $dropoffLng;
        foreach ($extraStops as $stop) {
            $total += $this->haversineDistance($prevLat, $prevLng, $stop['lat'], $stop['lng']);
            $prevLat = $stop['lat'];
            $prevLng = $stop['lng'];
        }

        return $total;
    }

    /**
     * Coerce the incoming stops to a clean list of {lat, lng} floats, dropping
     * any element without a usable coordinate pair. Defensive: pricing must
     * never fault on a malformed stop, and a bad stop must not silently inflate
     * the fare with a garbage leg.
     *
     * @param  array<mixed>  $extraStops
     * @return list<array{lat:float,lng:float}>
     */
    private function sanitizeStops(array $extraStops): array
    {
        $clean = [];
        foreach ($extraStops as $stop) {
            if (! is_array($stop) || ! isset($stop['lat'], $stop['lng']) || ! is_numeric($stop['lat']) || ! is_numeric($stop['lng'])) {
                continue;
            }
            $clean[] = ['lat' => (float) $stop['lat'], 'lng' => (float) $stop['lng']];
        }

        return $clean;
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
