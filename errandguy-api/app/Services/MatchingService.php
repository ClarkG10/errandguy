<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

class MatchingService
{
    /**
     * Find the best available runner for a booking.
     * Returns the matched runner profile or null.
     */
    public function findRunner(string $bookingId): ?RunnerProfile
    {
        $booking = Booking::with('errandType')->findOrFail($bookingId);

        $radiusKm = (float) SystemConfig::getValue('matching_radius_km', '10');

        $runners = $this->getEligibleRunners(
            $booking->pickup_lat,
            $booking->pickup_lng,
            $radiusKm,
            $booking->errand_type_id
        );

        if ($runners->isEmpty()) {
            Log::info("No runners found for booking {$bookingId}");
            return null;
        }

        // Return the top-scored runner
        return $runners->first();
    }

    /**
     * Broadcast a negotiate-mode booking to nearby eligible runners.
     */
    public function broadcastToRunners(string $bookingId): Collection
    {
        $booking = Booking::with('errandType')->findOrFail($bookingId);

        $radiusKm = (float) SystemConfig::getValue('matching_radius_km', '10');

        $runners = $this->getEligibleRunners(
            $booking->pickup_lat,
            $booking->pickup_lng,
            $radiusKm,
            $booking->errand_type_id
        );

        // Set negotiate expiration (30 minutes)
        $booking->update([
            'negotiate_expires_at' => now()->addMinutes(30),
        ]);

        Log::info("Broadcasting booking {$bookingId} to {$runners->count()} runners");

        return $runners;
    }

    /**
     * Query eligible online runners within radius, sorted by score.
     */
    private function getEligibleRunners(
        float $lat,
        float $lng,
        float $radiusKm,
        string $errandTypeId
    ): Collection {
        $runners = RunnerProfile::where('is_online', true)
            ->where('verification_status', 'approved')
            ->whereNotNull('current_lat')
            ->whereNotNull('current_lng')
            ->with('user')
            ->get();

        // Filter by distance and preferred errand types
        $eligible = $runners->filter(function (RunnerProfile $runner) use ($lat, $lng, $radiusKm, $errandTypeId) {
            $distance = $this->haversineDistance(
                $lat,
                $lng,
                (float) $runner->current_lat,
                (float) $runner->current_lng
            );

            if ($distance > $radiusKm) {
                return false;
            }

            // Check preferred types
            $preferredTypes = $runner->preferred_types ?? [];
            if (!empty($preferredTypes) && !in_array($errandTypeId, $preferredTypes)) {
                return false;
            }

            // Store distance for sorting
            $runner->setAttribute('distance_km', round($distance, 2));

            return true;
        });

        // Sort by: distance (nearest), acceptance_rate (highest), rating (highest)
        return $eligible->sortBy([
            ['distance_km', 'asc'],
            ['acceptance_rate', 'desc'],
        ])->values();
    }

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
}
