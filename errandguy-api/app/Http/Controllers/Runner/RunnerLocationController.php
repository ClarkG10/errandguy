<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\UpdateLocationRequest;
use App\Services\LocationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class RunnerLocationController extends Controller
{
    public function __construct(
        private LocationService $locationService,
    ) {}

    public function store(UpdateLocationRequest $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validated();

        // Resolving the active booking on every GPS push is wasteful — a
        // runner emitting at 12 ticks/min runs this same query 720
        // times/hour with the same answer until status flips. Cache the
        // booking id for 30s, keyed per-runner; status transitions
        // explicitly bust the cache via `Cache::forget` (see
        // RunnerErrandController::updateStatus and acceptErrand) so
        // pickup/dropoff transitions are reflected immediately.
        $cacheKey = "runner_active_booking_id:{$user->id}";
        $activeBookingId = Cache::remember($cacheKey, 30, function () use ($user) {
            return $user->runnerBookings()
                ->whereNotIn('status', ['completed', 'cancelled', 'pending', 'no_runner'])
                ->value('id');
        });

        $updated = $this->locationService->updateRunnerLocation(
            $user->id,
            $validated,
            $activeBookingId
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
