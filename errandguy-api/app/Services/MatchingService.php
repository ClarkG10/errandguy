<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

class MatchingService
{
    /**
     * Find the best available runner for a booking.
     * Returns the matched runner profile or null.
     *
     * @param  float|null  $radiusOverrideKm  When set, ignores SystemConfig
     *         and uses this radius instead. Used by retry-match to
     *         progressively widen the search after a failed attempt.
     */
    public function findRunner(string $bookingId, ?float $radiusOverrideKm = null, ?string $excludeUserId = null): ?RunnerProfile
    {
        $booking = Booking::with('errandType')->findOrFail($bookingId);

        $radiusKm = $radiusOverrideKm
            ?? (float) SystemConfig::getValue('matching_radius_km', '10');

        $runners = $this->getEligibleRunners(
            $booking->pickup_lat,
            $booking->pickup_lng,
            $radiusKm,
            $booking->errand_type_id,
            $excludeUserId,
            excludeCustomerId: $booking->customer_id,
        );

        if ($runners->isEmpty()) {
            Log::info("No runners found for booking {$bookingId} (radius: {$radiusKm}km)");
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

        // Broadcast offers to ALL eligible runners, so use a larger cap than
        // the findRunner path (which only needs the nearest one). Still bounded
        // so a dense city can't return an unbounded set. (P5)
        $runners = $this->getEligibleRunners(
            $booking->pickup_lat,
            $booking->pickup_lng,
            $radiusKm,
            $booking->errand_type_id,
            limit: 200,
            excludeCustomerId: $booking->customer_id,
        );

        // NOTE: negotiate_expires_at is deliberately NOT set here. The create
        // path (BookingController) is the single source of truth — it sets the
        // expiry from the `negotiate_timeout_minutes` config, anchored to the
        // broadcast time, and schedules ExpireNegotiateBookingJob for the same
        // instant. Overwriting it here (with a hardcoded 30m) contradicted the
        // config value, the offer payload, the client countdown, and the
        // runner-accept guard. Broadcasting is a pure read of eligible runners.

        Log::info("Broadcasting booking {$bookingId} to {$runners->count()} runners");

        return $runners;
    }

    /**
     * Query eligible online runners within radius, sorted by score.
     */
    /**
     * @param  int  $limit  Max runners to hydrate. The findRunner path only
     *         needs the nearest (->first()), so it takes the tight default; the
     *         broadcast path offers to ALL eligible runners, so it passes a
     *         larger cap. Either way the set is bounded — cost no longer scales
     *         with idle-online-runner density.
     */
    private function getEligibleRunners(
        float $lat,
        float $lng,
        float $radiusKm,
        string $errandTypeId,
        ?string $excludeUserId = null,
        int $limit = 50,
        ?string $excludeCustomerId = null
    ): Collection {
        $runners = RunnerProfile::where('is_online', true)
            ->where('verification_status', 'approved')
            // Skip a specific runner (e.g. the one who just let a matched
            // offer time out) so a re-match tries someone else first.
            ->when($excludeUserId, fn ($q) => $q->where('user_id', '!=', $excludeUserId))
            // Never match a booking to its OWN customer. A user who is both the
            // customer here and an online, approved runner could otherwise be
            // matched/offered their own errand (reachable via the re-match paths
            // after a role switch) and settle it — paying as customer, collecting
            // the runner payout.
            ->when($excludeCustomerId, fn ($q) => $q->where('user_id', '!=', $excludeCustomerId))
            ->whereNotNull('current_lat')
            ->whereNotNull('current_lng')
            // Cheap bounding-box prefilter so we don't haversine every
            // online runner in the country. ~111km per latitude degree;
            // longitude scales with cos(lat). We add a 25% safety margin
            // because the box is a square inscribing the search circle's
            // outer edge \u2014 we'd otherwise clip nearby runners at the
            // 45\u00b0 corners.
            ->where(function ($q) use ($lat, $lng, $radiusKm) {
                $latDelta = ($radiusKm * 1.25) / 111.0;
                $cos = max(0.000001, cos(deg2rad($lat)));
                $lngDelta = ($radiusKm * 1.25) / (111.0 * $cos);
                $q->whereBetween('current_lat', [$lat - $latDelta, $lat + $latDelta])
                  ->whereBetween('current_lng', [$lng - $lngDelta, $lng + $lngDelta]);
            })
            // Reject runners whose last GPS ping is older than 5 minutes \u2014
            // their phone is likely dead/in-tunnel and dispatching to them
            // wastes the broadcast slot and frustrates the customer.
            ->where(function ($q) {
                $q->where('last_location_at', '>=', now()->subMinutes(5))
                  ->orWhereNull('last_location_at'); // legacy rows; haversine still applies
            })
            // Exclude runners who already hold an active errand. Without
            // this they can be re-broadcast to and accidentally accept
            // two errands in parallel.
            ->whereDoesntHave('user.runnerBookings', function ($q) {
                $q->whereNotIn('status', ['pending', 'completed', 'cancelled', 'no_runner']);
            })
            ->with('user')
            // Rank nearest-first IN SQL and cap the hydrated set, instead of
            // loading every online runner inside the bounding box and sorting
            // in PHP (cost scaled with idle-runner density, in the customer's
            // synchronous create request). Squared planar distance is a fine
            // proxy for ranking within this small box; the exact haversine +
            // preferred-type filter below still runs over the nearest $limit
            // rows, and re-sorts by (distance, acceptance_rate). (P5)
            ->orderByRaw(
                '((current_lat - ?) * (current_lat - ?)) + ((current_lng - ?) * (current_lng - ?)) asc',
                [$lat, $lat, $lng, $lng]
            )
            ->limit($limit)
            ->get();

        // Filter by distance and preferred errand types
        $errandTypeSlug = ErrandType::whereKey($errandTypeId)->value('slug');
        $eligible = $runners->filter(function (RunnerProfile $runner) use ($lat, $lng, $radiusKm, $errandTypeSlug) {
            $distance = $this->haversineDistance(
                $lat,
                $lng,
                (float) $runner->current_lat,
                (float) $runner->current_lng
            );

            if ($distance > $radiusKm) {
                return false;
            }

            // Check preferred types — stored as errand-type slugs.
            $preferredTypes = $runner->preferred_types ?? [];
            if (!empty($preferredTypes) && $errandTypeSlug && !in_array($errandTypeSlug, $preferredTypes, true)) {
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
