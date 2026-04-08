<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\UpdateLocationRequest;
use App\Services\LocationService;
use Illuminate\Http\JsonResponse;

class RunnerLocationController extends Controller
{
    public function __construct(
        private LocationService $locationService,
    ) {}

    public function store(UpdateLocationRequest $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validated();

        // Get active booking for context
        $activeBooking = $user->runnerBookings()
            ->whereNotIn('status', ['completed', 'cancelled', 'pending'])
            ->first();

        $updated = $this->locationService->updateRunnerLocation(
            $user->id,
            $validated,
            $activeBooking?->id
        );

        if (!$updated) {
            return response()->json([
                'message' => 'Location update throttled. Try again in a few seconds.',
            ], 429);
        }

        return response()->json([
            'message' => 'Location updated.',
        ]);
    }
}
