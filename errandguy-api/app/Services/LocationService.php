<?php

namespace App\Services;

use App\Events\RouteDeviationAlert;
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
     */
    public function getNearbyRunners(
        float $lat,
        float $lng,
        float $radiusKm,
        ?string $vehicleType = null,
        ?string $errandTypeId = null
    ): Collection {
        $query = RunnerProfile::where('is_online', true)
            ->where('verification_status', 'approved')
            ->whereNotNull('current_lat')
            ->whereNotNull('current_lng')
            ->with('user');

        if ($vehicleType) {
            $query->where('vehicle_type', $vehicleType);
        }

        $runners = $query->get();

        return $runners->filter(function (RunnerProfile $runner) use ($lat, $lng, $radiusKm, $errandTypeId) {
            $distance = $this->haversineDistance(
                $lat,
                $lng,
                (float) $runner->current_lat,
                (float) $runner->current_lng
            );

            if ($distance > $radiusKm) {
                return false;
            }

            // Filter by preferred errand type
            if ($errandTypeId) {
                $preferred = $runner->preferred_types ?? [];
                if (!empty($preferred) && !in_array($errandTypeId, $preferred)) {
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
