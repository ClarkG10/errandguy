<?php

namespace App\Http\Controllers;

use App\Models\Booking;
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
            ->with(['runner', 'runner.runnerProfile'])
            ->firstOrFail();

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
