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
                    'name' => $runner->full_name,
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
}
