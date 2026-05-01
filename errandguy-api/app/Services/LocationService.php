<?php

namespace App\Services;

use App\Events\RouteDeviationAlert;
use App\Models\ErrandType;
use App\Models\RunnerLocation;
use App\Models\RunnerProfile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class LocationService
{
    /**
     * Update a runner's location and insert into runner_locations table.
     * Throttled to max 1 update per 5 seconds per runner.
     */
    public function updateRunnerLocation(
        string $runnerId,
        array $coords,
        ?string $bookingId = null
    ): bool {
        $cacheKey = "runner_location_throttle:{$runnerId}";

        // Cache::add() is atomic — only succeeds if key doesn't exist.
        // Prevents race condition where multiple requests pass the check simultaneously.
        if (!Cache::add($cacheKey, true, 5)) {
            return false;
        }

        // Insert location record
        RunnerLocation::create([
            'runner_id' => $runnerId,
            'booking_id' => $bookingId,
            'lat' => $coords['lat'],
            'lng' => $coords['lng'],
            'heading' => $coords['heading'] ?? null,
            'speed' => $coords['speed'] ?? null,
            'accuracy' => $coords['accuracy'] ?? null,
        ]);

        // Update runner profile current position
        RunnerProfile::where('user_id', $runnerId)->update([
            'current_lat' => $coords['lat'],
            'current_lng' => $coords['lng'],
            'last_location_at' => now(),
        ]);

        return true;
    }

    /**
     * Get the latest location for a runner.
     */
    public function getRunnerLocation(string $runnerId): ?RunnerLocation
    {
        return RunnerLocation::where('runner_id', $runnerId)
            ->orderByDesc('created_at')
            ->first();
    }

    /**
     * Find nearby online, approved runners within a radius.
     * Uses Haversine formula (PostGIS-free fallback).
     *
     * Performance note: a naive `WHERE is_online=true AND approved`
     * loads every online runner into memory before filtering by
     * distance — fine at 50 runners, painful at 5,000. We pre-filter
     * with a bounding box in SQL so the database does the rough
     * "could possibly be in range" cull, then PHP applies the exact
     * great-circle distance only on the candidate slice.
     *
     * 1° latitude ≈ 111 km everywhere; 1° longitude shrinks toward
     * the poles, so we widen the longitude window by `1 / cos(lat)`.
     * At Manila (~14°N) cos ≈ 0.97, so the box is barely larger than
     * a square — accuracy is exact (any miss would have failed the
     * subsequent haversine check anyway).
     */
    public function getNearbyRunners(
        float $lat,
        float $lng,
        float $radiusKm,
        ?string $vehicleType = null,
        ?string $errandTypeId = null
    ): Collection {
        $latDelta = $radiusKm / 111.0;
        // Guard against the equator-pole singularity (cos→0). At extreme
        // latitudes we just open the box to ±180° on lng — the haversine
        // post-filter still keeps the result correct.
        $cosLat = cos(deg2rad($lat));
        $lngDelta = $cosLat > 0.01 ? $radiusKm / (111.0 * $cosLat) : 180.0;

        $query = RunnerProfile::where('is_online', true)
            ->where('verification_status', 'approved')
            ->whereNotNull('current_lat')
            ->whereNotNull('current_lng')
            ->whereBetween('current_lat', [$lat - $latDelta, $lat + $latDelta])
            ->whereBetween('current_lng', [$lng - $lngDelta, $lng + $lngDelta])
            ->with('user');

        if ($vehicleType) {
            $query->where('vehicle_type', $vehicleType);
        }

        $runners = $query->get();

        // preferred_types is stored as errand-type slugs; resolve once.
        $errandTypeSlug = $errandTypeId
            ? ErrandType::whereKey($errandTypeId)->value('slug')
            : null;

        return $runners->filter(function (RunnerProfile $runner) use ($lat, $lng, $radiusKm, $errandTypeSlug) {
            $distance = $this->haversineDistance(
                $lat,
                $lng,
                (float) $runner->current_lat,
                (float) $runner->current_lng
            );

            if ($distance > $radiusKm) {
                return false;
            }

            // Filter by preferred errand type (slug match).
            if ($errandTypeSlug) {
                $preferred = $runner->preferred_types ?? [];
                if (!empty($preferred) && !in_array($errandTypeSlug, $preferred, true)) {
                    return false;
                }
            }

            return true;
        })->values();
    }

    /**
     * Clean up old location records (older than 24 hours).
     */
    public function cleanupOldLocations(): int
    {
        $deleted = RunnerLocation::where('created_at', '<', now()->subHours(24))->delete();
        Log::info("Cleaned up {$deleted} old runner location records.");

        return $deleted;
    }

    /**
     * Calculate distance between two points using the Haversine formula.
     * Returns distance in kilometers.
     */
    private function haversineDistance(
        float $lat1,
        float $lng1,
        float $lat2,
        float $lng2
    ): float {
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
