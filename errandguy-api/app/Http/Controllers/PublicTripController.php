<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\SOSAlert;
use Illuminate\Http\JsonResponse;

class PublicTripController extends Controller
{
    public function show(string $token): JsonResponse
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
            ->with(['runner', 'runner.runnerProfile'])
            ->first();

        // SOS fallback: the SOS live-link token lives on sos_alerts, NOT on
        // bookings.trip_share_token, so the customer/runner share query above
        // can never match it — the emergency link used to always 404. Resolve
        // it here instead. Safety deliberately overrides the trip-over status
        // cutoff (an active emergency keeps the link live even after the
        // booking closes); access is still gated by an active alert and the
        // 60-minute live_link_expires_at TTL, and flips off the moment
        // deactivateSOS resolves the alert.
        if (! $booking) {
            $alert = SOSAlert::where('live_link_token', $token)
                ->where('status', 'active')
                ->where('live_link_expires_at', '>', now())
                ->first();
            if ($alert) {
                $booking = Booking::with(['runner', 'runner.runnerProfile'])
                    ->find($alert->booking_id);
            }
        }

        abort_if(! $booking, 404);

        $latestLocation = \App\Models\RunnerLocation::where('booking_id', $booking->id)
            ->latest('created_at')
            ->first();

        $runner = $booking->runner;
        $profile = $runner?->runnerProfile;

        return response()->json([
            'data' => [
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
                ] : null,
            ],
        ]);
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
