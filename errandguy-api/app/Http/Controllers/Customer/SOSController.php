<?php

namespace App\Http\Controllers\Customer;

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
     * Raise an SOS on one of the customer's live errands. Optional body:
     * lat, lng (the phone's GPS) and accuracy (metres). A missing or unusable
     * fix never blocks the SOS.
     */
    public function trigger(Request $request, string $id): JsonResponse
    {
        $booking = Booking::where('customer_id', $request->user()->id)
            ->where('status', '!=', 'completed')
            ->where('status', '!=', 'cancelled')
            ->findOrFail($id);

        $alert = $this->sosService->triggerSOS(
            $booking->id,
            $request->user()->id,
            'customer',
            SOSService::deviceLocationFrom($request->only(['lat', 'lng', 'accuracy'])),
        );

        $summary = $this->sosService->alertSummary($alert);

        // A summary, never the model: the alert arrives with its booking
        // loaded (contact phones, photos, payout) and the raiser's account,
        // which an offered runner — or anyone — must not get from here.
        return response()->json([
            'data' => \App\Services\SOSService::publicSummary($alert),
            'message' => $summary['message'],
            'alerted' => $summary['alerted'],
        ], 201);
    }

    /** Call off the customer's OWN open SOS on this errand (never the runner's). */
    public function deactivate(Request $request, string $id): JsonResponse
    {
        Booking::where('customer_id', $request->user()->id)->findOrFail($id);

        $closed = $this->sosService->cancelByRaiser($id, $request->user()->id, 'customer');

        return response()->json([
            'data' => ['closed' => $closed],
            'message' => $closed > 0 ? 'SOS alert deactivated.' : 'You have no active SOS alert on this errand.',
        ]);
    }
}
