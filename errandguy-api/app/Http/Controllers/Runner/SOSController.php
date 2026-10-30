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
     * own the booking and the booking must still be in-flight. Optional body:
     * lat, lng (the phone's GPS) and accuracy (metres). A missing or unusable
     * fix never blocks the SOS.
     */
    public function trigger(Request $request, string $id): JsonResponse
    {
        $booking = Booking::where('runner_id', $request->user()->id)
            ->whereNotIn('status', ['completed', 'cancelled', 'no_runner'])
            ->findOrFail($id);

        $alert = $this->sosService->triggerSOS(
            $booking->id,
            $request->user()->id,
            'runner',
            SOSService::deviceLocationFrom($request->only(['lat', 'lng', 'accuracy'])),
        );

        $summary = $this->sosService->alertSummary($alert);

        return response()->json([
            'data' => $alert,
            'message' => $summary['message'],
            'alerted' => $summary['alerted'],
        ], 201);
    }

    /** Call off the runner's OWN open SOS on this errand (never the customer's). */
    public function deactivate(Request $request, string $id): JsonResponse
    {
        Booking::where('runner_id', $request->user()->id)->findOrFail($id);

        $closed = $this->sosService->cancelByRaiser($id, $request->user()->id, 'runner');

        return response()->json([
            'data' => ['closed' => $closed],
            'message' => $closed > 0 ? 'SOS alert deactivated.' : 'You have no active SOS alert on this errand.',
        ]);
    }
}
