<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Services\SOSService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SOSController extends Controller
{
    public function __construct(
        private SOSService $sosService,
    ) {}

    /**
     * Trigger SOS while a runner is on an active errand. The runner must
     * own the booking and the booking must still be in-flight.
     */
    public function trigger(Request $request, string $id): JsonResponse
    {
        $booking = Booking::where('runner_id', $request->user()->id)
            ->whereNotIn('status', ['completed', 'cancelled', 'no_runner'])
            ->findOrFail($id);

        $alert = $this->sosService->triggerSOS($booking->id, $request->user()->id, 'runner');

        return response()->json([
            'data' => $alert,
            'message' => 'SOS alert triggered. Emergency contacts have been notified.',
        ], 201);
    }

    public function deactivate(Request $request, string $id): JsonResponse
    {
        Booking::where('runner_id', $request->user()->id)->findOrFail($id);

        $this->sosService->deactivateSOS($id);

        return response()->json([
            'message' => 'SOS alert deactivated.',
        ]);
    }
}
