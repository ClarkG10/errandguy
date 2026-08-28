<?php

namespace App\Services;

use App\Events\RouteDeviationAlert;
use App\Events\RunnerLocationUpdated;
use App\Jobs\SendPushJob;
use App\Models\Booking;
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
     * Minimum seconds between denormalised-position writes to `runner_profiles`
     * per runner. The customer's live-track pin is fed by the fine-grained
     * `runner_locations` rows (still inserted on every accepted ping), so this
     * only governs the copy MatchingService reads — and matching tolerates a
     * stale position (it filters `last_location_at >= now()-5min` and searches
     * a radius). Writing that hot row on every 5s ping bloats the exact table
     * every matching scan hits; a coarser cadence cuts the write/contention
     * ~4× with no UX change. Comfortably inside the 5-min matching freshness
     * gate. See docs/scaling-tier0-rollout.md ("location write pipeline").
     */
    private const PROFILE_POSITION_TTL_SECONDS = 20;

    /**
     * Throttle for location rows that carry NO booking_id.
     *
     * A runner streams GPS from the moment they flip online, long before any
     * errand, and every one of those pings inserted a row into the platform's
     * busiest table. Nothing reads them: every consumer is booking-scoped
     * (BookingController::track, PublicTripController), and the only
     * runner-scoped reader has no callers. Matching doesn't use this table
     * either — it reads the denormalised position on runner_profiles, written
     * on its own throttle just below.
     *
     * So idle runners were generating the dominant write volume on the exact
     * table the customer's live-tracking read hits, and bloating the 24h
     * retention set the nightly prune chews through. Untagged pings now land
     * at the same coarse cadence as the profile write — enough for a support
     * breadcrumb, without the amplification. The instant a booking is
     * attached, the full ingest cadence resumes so the customer's pin stays
     * smooth.
     */
    private const UNTAGGED_LOCATION_TTL_SECONDS = 20;

    /**
     * "Runner is nearby" approach push — the two travel legs it covers, mapped
     * to the booking status that means the runner is actually driving TO that
     * target. Arrival itself is NOT here: the runner's manual
     * `arrived_at_pickup` / `arrived_at_dropoff` transitions already push
     * (SendBookingStatusNotification), so this only fills the missing
     * *advance* warning.
     *
     * Single-location errands (queue, bills payment) never reach `in_transit`
     * and carry no drop-off coords, so they naturally get the pickup leg only.
     */
    private const APPROACH_LEGS = [
        'pickup' => 'heading_to_pickup',
        'dropoff' => 'in_transit',
    ];

    /** Fire the approach push once the runner is inside this distance (km). */
    private const APPROACH_FIRE_RADIUS_KM = 0.3;

    /**
     * A leg only becomes eligible to fire after we have seen the runner at
     * least this far (km) from that leg's target on this booking. Without the
     * arming step a runner who accepts a job while already standing at the
     * pickup would trigger an "almost there" push that carries no information,
     * and one jittery first fix would burn the one-shot latch. The 300-600 m
     * band between the two radii is a deliberate dead zone: it neither arms nor
     * fires, so a runner idling near the boundary can't flap.
     */
    private const APPROACH_ARM_RADIUS_KM = 0.6;

    /**
     * Worst positional accuracy (metres) we will trust for an approach push. A
     * weak fix (indoors, urban canyon, Wi-Fi-only) routinely reports hundreds
     * of metres of error and can teleport the runner onto the target — crying
     * wolf on a one-shot push. Pings that omit accuracy entirely are trusted
     * (the field is optional and older clients don't send it).
     */
    private const APPROACH_MAX_ACCURACY_M = 100.0;

    /**
     * How long the per-leg arm/latch flags live. Comfortably longer than any
     * single travel leg, short enough that the keys expire on their own —
     * nothing has to clean them up on completion, and a booking id is never
     * reused so a stale flag can't leak onto another errand.
     */
    private const APPROACH_FLAG_TTL_SECONDS = 10800;

    /**
     * Booking coordinates/customer/errand-type are effectively immutable for
     * the life of an errand, so they are cached per booking instead of being
     * re-read on every 5 s ping. The mutable half (status) is read separately
     * and ONLY when a ping is already inside the fire radius.
     */
    private const APPROACH_META_TTL_SECONDS = 900;

    /**
     * Base approach copy per leg, written for the physical pickup→deliver flow.
     * Mirrors SendBookingStatusNotification: a per-errand-type override wins
     * where the base wording would be wrong (a passenger ride has a "driver",
     * a bills-payment pickup is a payment counter, not the customer's door).
     */
    private const APPROACH_TEMPLATES = [
        'pickup' => [
            'title' => 'Runner is nearby',
            'body' => 'Your runner is almost at the pickup location.',
        ],
        'dropoff' => [
            'title' => 'Runner is nearby',
            'body' => 'Your runner is almost at the drop-off location.',
        ],
    ];

    /** Keyed by errand_type slug → leg. Any leg not listed uses the base copy. */
    private const APPROACH_TYPE_OVERRIDES = [
        'transportation' => [
            'pickup' => [
                'title' => 'Driver is nearby',
                'body' => 'Your driver is almost at your pickup point.',
            ],
            'dropoff' => [
                'title' => 'Almost at your destination',
                'body' => 'You’re arriving at your destination.',
            ],
        ],
        'bills_payment' => [
            'pickup' => [
                'title' => 'Runner is nearby',
                'body' => 'Your runner is almost at the payment center.',
            ],
        ],
        'queue' => [
            'pickup' => [
                'title' => 'Runner is nearby',
                'body' => 'Your runner is almost at the queue location.',
            ],
        ],
    ];

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

        // Insert location record — full ingest cadence whenever a booking is
        // attached, so the customer's live pin stays smooth (track reads the
        // latest row). Untagged pings from a merely-online runner are
        // throttled: see UNTAGGED_LOCATION_TTL_SECONDS.
        $location = null;
        $shouldPersist = $bookingId !== null
            || Cache::add(
                "runner_untagged_loc_throttle:{$runnerId}",
                true,
                self::UNTAGGED_LOCATION_TTL_SECONDS,
            );

        if ($shouldPersist) {
            $location = RunnerLocation::create([
                'runner_id' => $runnerId,
                'booking_id' => $bookingId,
                'lat' => $coords['lat'],
                'lng' => $coords['lng'],
                'heading' => $coords['heading'] ?? null,
                'speed' => $coords['speed'] ?? null,
                'accuracy' => $coords['accuracy'] ?? null,
            ]);
        }

        // Push the fix live to the customer tracking this booking. Only when a
        // booking is attached — the `booking.{id}` channel is the customer's
        // tracking screen; an untagged online ping has no subscriber. This is
        // the one synchronous (ShouldBroadcastNow) broadcast, so guard it: a
        // Reverb outage must never turn a location ping into a failed request
        // (the ping also feeds matching freshness, which must always succeed).
        if ($bookingId && $location) {
            try {
                RunnerLocationUpdated::dispatch($location);
            } catch (\Throwable $e) {
                Log::warning('Runner location broadcast failed', [
                    'booking_id' => $bookingId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Denormalised current position for MatchingService. Throttled per
        // runner (see PROFILE_POSITION_TTL_SECONDS) so the hot row on the
        // matching table isn't rewritten on every ping. The first ping after
        // going online passes immediately (key absent), then at most once per
        // window; RunnerOnlineController already seeds the position on toggle.
        $profileKey = "runner_profile_pos_throttle:{$runnerId}";
        if (Cache::add($profileKey, true, self::PROFILE_POSITION_TTL_SECONDS)) {
            RunnerProfile::where('user_id', $runnerId)->update([
                'current_lat' => $coords['lat'],
                'current_lng' => $coords['lng'],
                'last_location_at' => now(),
            ]);
        }

        // Server-side "your runner is nearby" advance warning. Runs LAST — after
        // every durable write — and is fully swallowed on failure, exactly like
        // the broadcast guard above: this is a convenience push, and a ping must
        // never fail because a notification couldn't be enqueued (the ping also
        // feeds matching freshness and the customer's live pin).
        if ($bookingId) {
            try {
                $this->notifyCustomerOnApproach($bookingId, $coords);
            } catch (\Throwable $e) {
                Log::warning('Nearby-approach notification failed', [
                    'booking_id' => $bookingId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return true;
    }

    /**
     * Push the CUSTOMER a one-shot "runner is nearby" when the runner closes to
     * within APPROACH_FIRE_RADIUS_KM of the target of the leg they are actually
     * travelling (pickup while `heading_to_pickup`, drop-off while
     * `in_transit`).
     *
     * Before this existed the only proximity signal was a React effect on the
     * mounted customer tracking screen, so the cue died the moment the customer
     * switched screens or backgrounded the app — i.e. it only worked for people
     * who were already watching, which is the waiting it was meant to remove.
     *
     * Cost discipline (this is the hottest write path in the app):
     *   - immutable booking data is cached per booking (APPROACH_META_TTL_SECONDS);
     *   - the distance work is two haversines on data already in hand;
     *   - the booking's STATUS is read only for a ping that is already inside
     *     the fire radius on an armed, unlatched leg — a handful of times per
     *     errand, never per ping;
     *   - the push itself goes out through the queued SendPushJob, so no
     *     Expo/FCM call ever happens on the ping request.
     */
    private function notifyCustomerOnApproach(string $bookingId, array $coords): void
    {
        $accuracy = $coords['accuracy'] ?? null;
        if ($accuracy !== null && (float) $accuracy > self::APPROACH_MAX_ACCURACY_M) {
            return;
        }

        $meta = $this->approachMeta($bookingId);
        if (empty($meta)) {
            return;
        }

        foreach (self::APPROACH_LEGS as $leg => $legStatus) {
            $targetLat = $meta["{$leg}_lat"] ?? null;
            $targetLng = $meta["{$leg}_lng"] ?? null;
            if ($targetLat === null || $targetLng === null) {
                continue;
            }

            $distanceKm = $this->haversineDistance(
                (float) $coords['lat'],
                (float) $coords['lng'],
                (float) $targetLat,
                (float) $targetLng
            );

            $armKey = "nearby_armed:{$bookingId}:{$leg}";

            // Far from this leg's target → arm it (idempotent: Cache::add is a
            // no-op once the flag exists) and do nothing else. Note this arms
            // the drop-off leg while the runner is still heading to pickup,
            // which is exactly right — by `in_transit` the leg is ready.
            if ($distanceKm > self::APPROACH_ARM_RADIUS_KM) {
                Cache::add($armKey, true, self::APPROACH_FLAG_TTL_SECONDS);
                continue;
            }

            // Dead band between the two radii: neither arm nor fire.
            if ($distanceKm > self::APPROACH_FIRE_RADIUS_KM) {
                continue;
            }

            $latchKey = "nearby_notified:{$bookingId}:{$leg}";

            // Cheapest early-out: already notified for this leg. Keeps the rest
            // of the leg (dozens of pings inside the radius) at one cache read.
            if (Cache::has($latchKey)) {
                continue;
            }

            if (!Cache::has($armKey)) {
                continue;
            }

            // Only now is a DB read justified — and it is the authoritative
            // check that the runner is travelling THIS leg, so a cached target
            // can never mis-fire across a status transition.
            if (Booking::whereKey($bookingId)->value('status') !== $legStatus) {
                continue;
            }

            // Atomic one-shot latch: a retried or duplicated ping cannot send a
            // second push for the same booking leg.
            if (!Cache::add($latchKey, true, self::APPROACH_FLAG_TTL_SECONDS)) {
                continue;
            }

            $slug = $meta['slug'] ?? null;
            $copy = ($slug ? (self::APPROACH_TYPE_OVERRIDES[$slug][$leg] ?? null) : null)
                ?? self::APPROACH_TEMPLATES[$leg];

            // Queued and DEVICE-ONLY. The point of this ping is to reach a
            // customer who isn't looking at their phone; anyone with the app
            // open already sees the runner closing in on the live map. A
            // persisted "your runner is nearby" row would be stale clutter
            // minutes later, once they have arrived and gone — the same reason
            // chat and job offers use the remote-only path. Deliberately keeps
            // the `booking_update` type the status pushes use, so the existing
            // mobile tap handler routes it to this booking's tracking screen
            // with no client change.
            SendPushJob::dispatch(
                $meta['customer_id'],
                $copy['title'],
                $copy['body'],
                [
                    'type' => 'booking_update',
                    'booking_id' => $bookingId,
                    'status' => $legStatus,
                    'leg' => $leg,
                ],
                remoteOnly: true,
            );
        }
    }

    /**
     * Immutable-for-the-errand booking data the approach check needs, cached per
     * booking. Returns [] for a booking that can't be notified — and [] caches
     * fine (unlike null, which Cache::remember refuses to store), so a
     * customer-less booking doesn't re-query on every ping.
     *
     * @return array<string,mixed>
     */
    private function approachMeta(string $bookingId): array
    {
        return Cache::remember(
            "nearby_meta:{$bookingId}",
            self::APPROACH_META_TTL_SECONDS,
            function () use ($bookingId) {
                $booking = Booking::query()
                    ->with('errandType:id,slug')
                    ->find($bookingId, [
                        'id',
                        'customer_id',
                        'errand_type_id',
                        'pickup_lat',
                        'pickup_lng',
                        'dropoff_lat',
                        'dropoff_lng',
                    ]);

                if (!$booking || !$booking->customer_id) {
                    return [];
                }

                return [
                    'customer_id' => $booking->customer_id,
                    'slug' => $booking->errandType?->slug,
                    'pickup_lat' => $booking->pickup_lat !== null ? (float) $booking->pickup_lat : null,
                    'pickup_lng' => $booking->pickup_lng !== null ? (float) $booking->pickup_lng : null,
                    'dropoff_lat' => $booking->dropoff_lat !== null ? (float) $booking->dropoff_lat : null,
                    'dropoff_lng' => $booking->dropoff_lng !== null ? (float) $booking->dropoff_lng : null,
                ];
            }
        );
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
     * Prune runner-location history older than the retention window.
     *
     * Deletes in bounded batches instead of one mass DELETE (PERF-BE-4): this
     * table is the busiest write path AND is read by the customer tracking
     * endpoint, so a single large delete would hold locks + a long transaction
     * on the hot row range. Batching keeps each statement short. The prune runs
     * off the new idx_runner_locations_created index.
     *
     * Select-then-delete-by-id (rather than DELETE ... LIMIT) keeps this
     * portable: MySQL supports DELETE ... LIMIT but SQLite (test engine) does
     * not unless specially compiled.
     */
    public function cleanupOldLocations(int $retentionHours = 24, int $batchSize = 1000): int
    {
        $cutoff = now()->subHours($retentionHours);
        $total = 0;

        do {
            $ids = RunnerLocation::where('created_at', '<', $cutoff)
                ->limit($batchSize)
                ->pluck('id');

            if ($ids->isEmpty()) {
                break;
            }

            $total += RunnerLocation::whereIn('id', $ids)->delete();
        } while ($ids->count() === $batchSize);

        Log::info("Cleaned up {$total} old runner location records.");

        return $total;
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
