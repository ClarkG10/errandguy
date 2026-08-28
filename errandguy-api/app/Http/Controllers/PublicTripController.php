<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\SOSAlert;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class PublicTripController extends Controller
{
    /**
     * Errand type slugs that finish at a single location (no drop-off leg).
     * Must stay in sync with RunnerErrandController::SINGLE_LOCATION_SLUGS
     * and mobile errandTypeRules.ts singleLocation.
     */
    private const SINGLE_LOCATION_SLUGS = ['queue', 'bills_payment'];

    /**
     * Public status ladders, mirroring RunnerErrandController's per-type
     * STATUS_ORDER constants but with recipient-facing copy (the viewer is a
     * family member / trusted contact, not the runner). `pending` fronts each
     * ladder because a share link can be minted before a runner accepts.
     */
    private const FLOW_DEFAULT = [
        'pending' => 'Finding a runner',
        'accepted' => 'Runner assigned',
        'heading_to_pickup' => 'On the way to pick-up',
        'arrived_at_pickup' => 'At the pick-up point',
        'picked_up' => 'Picked up',
        'in_transit' => 'On the way to drop-off',
        'arrived_at_dropoff' => 'At the drop-off point',
        'delivered' => 'Delivered',
        'completed' => 'Completed',
    ];

    private const FLOW_TRANSPORT = [
        'pending' => 'Finding a driver',
        'accepted' => 'Driver assigned',
        'heading_to_pickup' => 'On the way to the pick-up point',
        'arrived_at_pickup' => 'Waiting at the pick-up point',
        'picked_up' => 'Ride started',
        'in_transit' => 'On the way to the destination',
        'arrived_at_dropoff' => 'Arrived at the destination',
        'completed' => 'Ride complete',
    ];

    private const FLOW_SINGLE_LOCATION = [
        'pending' => 'Finding a runner',
        'accepted' => 'Runner assigned',
        'heading_to_pickup' => 'On the way to the location',
        'arrived_at_pickup' => 'At the location',
        'picked_up' => 'Doing the errand',
        'completed' => 'Done',
    ];

    /**
     * Statuses that are not themselves ladder steps but sit ON one.
     * `matched` = a runner was offered the errand but hasn't accepted yet, so
     * from the recipient's point of view it is still "finding a runner".
     */
    private const STATUS_ALIASES = ['matched' => 'pending'];

    /** Terminal statuses that never appear in a ladder. */
    private const TERMINAL_LABELS = [
        'cancelled' => 'Errand cancelled',
        'no_runner' => 'No runner was available',
    ];

    /** Statuses where the runner is actually travelling, so an ETA means something. */
    private const ETA_STATUSES = ['accepted', 'heading_to_pickup', 'picked_up', 'in_transit'];

    /**
     * Rough urban speed (km/h) for the DISPLAY-ONLY "~N min away" line. This is
     * a straight-line estimate on purpose: the public page must not bill a
     * routing provider per poll. Never feeds pricing or any settlement path.
     */
    private const ETA_SPEED_KMH = 22;

    /** Beyond this the last GPS fix is too old to derive an honest ETA from. */
    private const ETA_MAX_FIX_AGE_SECONDS = 600;

    public function show(string $token): JsonResponse
    {
        [$booking, $viaSos] = $this->resolveToken($token);

        abort_if(! $booking, 404);

        return response()->json([
            'data' => $this->payload($booking, $viaSos),
        ]);
    }

    /**
     * PUBLIC WEB PAGE for the very same token.
     *
     * Trip-share (TripShareController::share) and the SOS live link
     * (NotifySosContactsJob) both hand out config('app.url')."/trip/{token}",
     * but the only handler used to be the JSON route under /api/v1 — so every
     * recipient who tapped a shared link, including a trusted contact during an
     * emergency, landed on a Laravel 404. This renders a self-contained page
     * around the exact same payload (nothing extra is exposed) and the page
     * then re-polls the JSON endpoint itself.
     *
     * Unlike show(), an unresolvable token is NOT a 404 here: a recipient whose
     * link expired, was revoked, or whose errand simply finished gets a plain
     * "this trip has ended" page instead of a framework error screen. The page
     * carries no trip data in that state, so it is not a token oracle either.
     */
    public function page(string $token): Response
    {
        [$booking, $viaSos] = $this->resolveToken($token);

        return response()->view('trip', [
            'token' => $token,
            'trip' => $booking ? $this->payload($booking, $viaSos) : null,
        ]);
    }

    /**
     * Resolve a public token to the booking it may watch.
     *
     * @return array{0: ?Booking, 1: bool} [booking, resolved-via-SOS-token]
     */
    private function resolveToken(string $token): array
    {
        $booking = Booking::where('trip_share_token', $token)
            ->where('trip_share_active', true)
            // PRIVACY: Auto-expire shared links once the trip is over so the
            // recipient can't keep watching the runner / customer addresses
            // indefinitely. The customer can still re-share if they reopen
            // (rebook) the errand.
            ->whereNotIn('status', ['completed', 'cancelled', 'no_runner'])
            // TTL backstop: a share link also dies after trip_share_expires_at.
            // Lenient (NULL still resolves) on purpose — a NULL expiry means a
            // link minted before this column existed (or by another backend
            // that doesn't set it), and we must not 404 a live in-progress trip
            // on that account. Laravel's share() always stamps an expiry, so
            // going forward every Laravel-minted active link is time-bounded.
            ->where(function ($q) {
                $q->whereNull('trip_share_expires_at')
                  ->orWhere('trip_share_expires_at', '>', now());
            })
            ->with(['runner', 'runner.runnerProfile', 'errandType'])
            ->first();

        if ($booking) {
            return [$booking, false];
        }

        // SOS fallback: the SOS live-link token lives on sos_alerts, NOT on
        // bookings.trip_share_token, so the customer/runner share query above
        // can never match it — the emergency link used to always 404. Resolve
        // it here instead. Safety deliberately overrides the trip-over status
        // cutoff (an active emergency keeps the link live even after the
        // booking closes); access is still gated by an active alert and the
        // 60-minute live_link_expires_at TTL, and flips off the moment
        // deactivateSOS resolves the alert.
        $alert = SOSAlert::where('live_link_token', $token)
            ->where('status', 'active')
            ->where('live_link_expires_at', '>', now())
            ->first();

        if ($alert) {
            $booking = Booking::with(['runner', 'runner.runnerProfile', 'errandType'])
                ->find($alert->booking_id);

            if ($booking) {
                return [$booking, true];
            }
        }

        return [null, false];
    }

    /**
     * The single public projection of a booking, shared by the JSON endpoint
     * and the web page. Everything here is deliberately sanitized: no
     * customer identity, no contact numbers, no money, no booking number.
     */
    private function payload(Booking $booking, bool $viaSos): array
    {
        // Scope to the booking's CURRENT runner (mirrors BookingController::track).
        // After a re-match (runner A never accepts → reassigned to B), a
        // booking_id-only query would return A's last GPS pinned under B's
        // identity on this public / SOS trip link — a safety-adjacent surface.
        // Until the new runner pings, correctly return no location.
        $latestLocation = $booking->runner_id
            ? \App\Models\RunnerLocation::where('booking_id', $booking->id)
                ->where('runner_id', $booking->runner_id)
                ->latest('created_at')
                ->first()
            : null;

        $runner = $booking->runner;
        $profile = $runner?->runnerProfile;
        // Age of the last fix in whole seconds. Computed off raw timestamps
        // rather than Carbon's diffInSeconds because that helper's $absolute
        // default flipped between Carbon 2 and 3.
        $fixAge = $latestLocation?->created_at
            ? max(0, now()->getTimestamp() - $latestLocation->created_at->getTimestamp())
            : null;

        return [
            'booking_id' => $booking->id,
            'status' => $booking->status,
            'pickup_address' => $booking->pickup_address,
            'dropoff_address' => $booking->dropoff_address,
            'pickup_lat' => $booking->pickup_lat,
            'pickup_lng' => $booking->pickup_lng,
            'dropoff_lat' => $booking->dropoff_lat,
            'dropoff_lng' => $booking->dropoff_lng,
            'errand_type' => $booking->errand_type_id,
            'runner' => $runner ? [
                // Only first name + initial of surname so a stranger
                // tracking the link can identify the runner without
                // getting their full identity from a forwarded URL.
                'name' => $this->shortenName($runner->full_name),
                'avatar_url' => $runner->avatar_url,
                'rating' => $runner->avg_rating,
                'vehicle_type' => $profile?->vehicle_type,
                'plate_number' => $profile?->vehicle_plate,
            ] : null,
            'runner_location' => $latestLocation ? [
                'lat' => $latestLocation->lat,
                'lng' => $latestLocation->lng,
                'updated_at' => $latestLocation->created_at,
                // Additive: lets the page say "updated 12s ago" without
                // trusting the viewer's device clock.
                'age_seconds' => $fixAge,
            ] : null,
            // --- additive, display-only fields for the public page ---
            'errand_type_slug' => $booking->errandType?->slug,
            'errand_type_name' => $booking->errandType?->name,
            'status_label' => $this->statusLabel($booking),
            'status_steps' => $this->statusSteps($booking),
            'eta' => $this->eta($booking, $latestLocation, $fixAge),
            'is_ended' => in_array($booking->status, ['completed', 'cancelled', 'no_runner'], true),
            // True ONLY when the token itself was an SOS live link, so a plain
            // trip-share recipient is never told about an emergency they
            // weren't given the emergency link for.
            'sos_active' => $viaSos,
        ];
    }

    /** Pick the public status ladder for a booking's errand type. */
    private function flowFor(Booking $booking): array
    {
        if ($booking->is_transportation) {
            return self::FLOW_TRANSPORT;
        }

        $slug = $booking->errandType?->slug;
        if ($slug && in_array($slug, self::SINGLE_LOCATION_SLUGS, true)) {
            return self::FLOW_SINGLE_LOCATION;
        }

        return self::FLOW_DEFAULT;
    }

    private function currentStepKey(Booking $booking): string
    {
        return self::STATUS_ALIASES[$booking->status] ?? $booking->status;
    }

    private function statusLabel(Booking $booking): string
    {
        if (isset(self::TERMINAL_LABELS[$booking->status])) {
            return self::TERMINAL_LABELS[$booking->status];
        }

        $flow = $this->flowFor($booking);

        return $flow[$this->currentStepKey($booking)]
            // Any status we don't have copy for (a new one shipped by another
            // writer) still renders readably instead of blank.
            ?? ucfirst(str_replace('_', ' ', (string) $booking->status));
    }

    /**
     * @return array<int, array{key: string, label: string, state: string}>
     */
    private function statusSteps(Booking $booking): array
    {
        $flow = $this->flowFor($booking);
        $keys = array_keys($flow);
        $index = array_search($this->currentStepKey($booking), $keys, true);

        $steps = [];
        foreach ($keys as $i => $key) {
            if ($index === false) {
                // Cancelled / no_runner / unknown: no step is "current".
                $state = 'upcoming';
            } else {
                $state = $i < $index ? 'done' : ($i === $index ? 'current' : 'upcoming');
            }

            $steps[] = ['key' => $key, 'label' => $flow[$key], 'state' => $state];
        }

        return $steps;
    }

    /**
     * Straight-line, display-only ETA to the leg's target. Returns null unless
     * the runner is genuinely in motion on a fresh GPS fix — a stale fix would
     * make the page lie to someone waiting on it.
     *
     * @return array{target: string, distance_km: float, minutes: int}|null
     */
    private function eta(Booking $booking, $latestLocation, ?int $fixAge): ?array
    {
        if (! $latestLocation || ! in_array($booking->status, self::ETA_STATUSES, true)) {
            return null;
        }
        if ($fixAge !== null && $fixAge > self::ETA_MAX_FIX_AGE_SECONDS) {
            return null;
        }

        $flow = $this->flowFor($booking);
        $headingToDropoff = $flow !== self::FLOW_SINGLE_LOCATION
            && in_array($booking->status, ['picked_up', 'in_transit'], true);

        $target = $headingToDropoff ? 'dropoff' : 'pickup';
        $lat = $headingToDropoff ? $booking->dropoff_lat : $booking->pickup_lat;
        $lng = $headingToDropoff ? $booking->dropoff_lng : $booking->pickup_lng;

        if ($lat === null || $lng === null) {
            return null;
        }

        $km = $this->haversineKm(
            (float) $latestLocation->lat,
            (float) $latestLocation->lng,
            (float) $lat,
            (float) $lng,
        );

        return [
            'target' => $target,
            'distance_km' => round($km, 2),
            'minutes' => max(1, (int) ceil($km / self::ETA_SPEED_KMH * 60)),
        ];
    }

    /** Distance in km between two points (Haversine). */
    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadiusKm = 6371;

        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) * sin($dLat / 2)
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2))
            * sin($dLng / 2) * sin($dLng / 2);

        return $earthRadiusKm * (2 * atan2(sqrt($a), sqrt(1 - $a)));
    }

    /**
     * Returns "Juan D." from "Juan Dela Cruz" so shared trip links don't
     * leak the runner's full surname to whoever the customer forwards
     * the link to.
     */
    private function shortenName(?string $fullName): string
    {
        if (! $fullName) {
            return 'Runner';
        }
        $parts = preg_split('/\s+/', trim($fullName)) ?: [];
        if (count($parts) === 1) {
            return $parts[0];
        }
        $first = $parts[0];
        $lastInitial = mb_substr($parts[count($parts) - 1], 0, 1);

        return "{$first} {$lastInitial}.";
    }
}
