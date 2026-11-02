<?php

namespace App\Services;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use App\Support\CashDebtPolicy;
use App\Support\VehicleClass;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

class MatchingService
{
    /**
     * How old a waiting runner's last location may be and still get offers.
     * The app stops sending location while the phone is locked, so a runner
     * waiting for work goes quiet within minutes even though they are online —
     * and the offer push is exactly what wakes them. Runners silent for longer
     * than this are switched offline by errandguy:expire-stale-runner-presence.
     */
    public const LOCATION_FRESHNESS_MINUTES = 15;

    /**
     * Find the best available runner for a booking.
     * Returns the matched runner profile or null.
     *
     * Never returns a runner the booking was already offered to in this round
     * of matching (they declined, let it lapse, or were taken off it), nor
     * $excludeUserId.
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

        $excludeUserIds = $booking->offeredRunnerIds();
        if ($excludeUserId !== null) {
            $excludeUserIds[] = $excludeUserId;
        }

        $runners = $this->getEligibleRunners(
            (float) $booking->pickup_lat,
            (float) $booking->pickup_lng,
            $radiusKm,
            $booking->errand_type_id,
            array_values(array_unique($excludeUserIds)),
            excludeCustomerId: $booking->customer_id,
            isCashBooking: $booking->payment_method === 'cash',
            bookedVehicle: $booking->vehicle_type_rate,
        );

        if ($runners->isEmpty()) {
            Log::info("No runners found for booking {$bookingId} (radius: {$radiusKm}km)");
            return null;
        }

        // Return the top-scored runner
        return $runners->first();
    }

    /**
     * Query eligible online runners within radius, sorted by score.
     *
     * @param  list<string>  $excludeUserIds  Runners never to offer this errand to.
     * @param  int  $limit  Max runners to hydrate. Only the nearest is used
     *         (->first()), so the set is bounded — cost no longer scales with
     *         idle-online-runner density.
     */
    private function getEligibleRunners(
        float $lat,
        float $lng,
        float $radiusKm,
        string $errandTypeId,
        array $excludeUserIds = [],
        int $limit = 50,
        ?string $excludeCustomerId = null,
        bool $isCashBooking = false,
        ?string $bookedVehicle = null,
    ): Collection {
        $allowedVehicles = VehicleClass::eligibleRunnerVehicles($bookedVehicle);

        $runners = RunnerProfile::where('is_online', true)
            ->where('verification_status', 'approved')
            // Skip every runner this errand was already offered to (and the one
            // just found busy mid-race), so a re-match always tries someone new.
            ->when($excludeUserIds !== [], fn ($q) => $q->whereNotIn('user_id', $excludeUserIds))
            // Never match a booking to its OWN customer. A user who is both the
            // customer here and an online, approved runner could otherwise be
            // matched/offered their own errand (reachable via the re-match paths
            // after a role switch) and settle it — paying as customer, collecting
            // the runner payout.
            ->when($excludeCustomerId, fn ($q) => $q->where('user_id', '!=', $excludeCustomerId))
            // The customer paid for this vehicle (PricingService prices per
            // rung), so only a runner whose vehicle is at least that rung may
            // take it — never a walker on a car fare. Walking errands (and older
            // bookings with no vehicle recorded) take anyone.
            ->when($allowedVehicles !== null, fn ($q) => $q->whereIn('vehicle_type', $allowedVehicles))
            ->whereHas('user', function ($user) use ($isCashBooking) {
                // Only an active account in runner mode can answer an offer: a
                // suspended runner is locked out of the app, and one who
                // switched to customer mode has no runner screen to accept on.
                $user->where('status', 'active')->where('role', 'runner');

                // Cash-debt ceiling: don't dispatch CASH work to a runner who
                // already owes more platform commission than the limit allows. A
                // cash errand settles by debiting their wallet, so offering it
                // would only deepen a debt we may never collect — and accept()
                // refuses it anyway (CashDebtPolicy is shared by both), so the
                // offer would be a guaranteed dead end that also burns the
                // dispatch slot. Prepaid and wallet errands are unaffected: those
                // CREDIT the runner, which is how they climb back above the line.
                if ($isCashBooking && CashDebtPolicy::enabled()) {
                    $user->where('wallet_balance', '>', -CashDebtPolicy::limit());
                }
            })
            ->whereNotNull('current_lat')
            ->whereNotNull('current_lng')
            // Cheap bounding-box prefilter so we don't haversine every
            // online runner in the country. ~111km per latitude degree;
            // longitude scales with cos(lat). We add a 25% safety margin
            // because the box is a square inscribing the search circle's
            // outer edge — we'd otherwise clip nearby runners at the
            // 45° corners.
            ->where(function ($q) use ($lat, $lng, $radiusKm) {
                $latDelta = ($radiusKm * 1.25) / 111.0;
                $cos = max(0.000001, cos(deg2rad($lat)));
                $lngDelta = ($radiusKm * 1.25) / (111.0 * $cos);
                $q->whereBetween('current_lat', [$lat - $latDelta, $lat + $latDelta])
                  ->whereBetween('current_lng', [$lng - $lngDelta, $lng + $lngDelta]);
            })
            // A waiting runner's phone stops reporting location when it locks,
            // so allow a position up to LOCATION_FRESHNESS_MINUTES old — the
            // offer push wakes the phone. Older than that, the position is too
            // stale to rank by distance.
            ->where(function ($q) {
                $q->where('last_location_at', '>=', now()->subMinutes(self::LOCATION_FRESHNESS_MINUTES))
                  ->orWhereNull('last_location_at'); // legacy rows; haversine still applies
            })
            // Exclude runners who already hold an offer or an active errand.
            // Without this they can be re-offered and accidentally accept two
            // errands in parallel.
            ->whereDoesntHave('user.runnerBookings', function ($q) {
                $q->whereIn('status', BookingStatus::RUNNER_HELD);
            })
            ->with('user')
            // Rank nearest-first IN SQL and cap the hydrated set, instead of
            // loading every online runner inside the bounding box and sorting
            // in PHP (cost scaled with idle-runner density, in the customer's
            // synchronous create request). Squared planar distance is a fine
            // proxy for ranking within this small box; the exact haversine +
            // preferred-type filter below still runs over the nearest $limit
            // rows, and re-sorts by exact distance. (P5)
            ->orderByRaw(
                '((current_lat - ?) * (current_lat - ?)) + ((current_lng - ?) * (current_lng - ?)) asc',
                [$lat, $lat, $lng, $lng]
            )
            ->limit($limit)
            ->get();

        // Filter by distance and preferred errand types. A retired type is
        // matched against the type that replaced it (ErrandType::preferenceSlug).
        $errandTypeSlug = ErrandType::whereKey($errandTypeId)->value('slug');
        $errandTypeSlug = $errandTypeSlug ? ErrandType::preferenceSlug($errandTypeSlug) : null;
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

        // Nearest first.
        return $eligible->sortBy('distance_km')->values();
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
