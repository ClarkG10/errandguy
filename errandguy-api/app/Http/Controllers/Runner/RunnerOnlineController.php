<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\ToggleOnlineRequest;
use Illuminate\Http\JsonResponse;

class RunnerOnlineController extends Controller
{
    public function toggle(ToggleOnlineRequest $request): JsonResponse
    {
        $profile = $request->user()->runnerProfile;

        if (!$profile) {
            return response()->json([
                'message' => 'Runner profile not found.',
            ], 404);
        }

        $validated = $request->validated();
        $goingOnline = (bool) $validated['is_online'];

        if ($goingOnline) {
            // Must be approved
            if ($profile->verification_status !== 'approved') {
                return response()->json([
                    'message' => 'Your account must be approved before going online.',
                ], 422);
            }

            // Must have at least 1 preferred errand type
            if (empty($profile->preferred_types)) {
                return response()->json([
                    'message' => 'Please set at least one preferred errand type before going online.',
                ], 422);
            }

            $profile->update([
                'is_online' => true,
                'current_lat' => $validated['lat'],
                'current_lng' => $validated['lng'],
                'last_location_at' => now(),
            ]);
        } else {
            // Check no active errand in progress
            $activeCount = $request->user()
                ->runnerBookings()
                ->whereNotIn('status', ['completed', 'cancelled', 'pending'])
                ->count();

            if ($activeCount > 0) {
                return response()->json([
                    'message' => 'You cannot go offline while you have an active errand.',
                ], 422);
            }

            $profile->update([
                'is_online' => false,
            ]);
        }

        return response()->json([
            'data' => [
                'is_online' => $profile->is_online,
            ],
            'message' => $goingOnline ? 'You are now online.' : 'You are now offline.',
        ]);
    }
}
