<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Services\SOSService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SOSController extends Controller
{
    public function __construct(
        private SOSService $sosService,
    ) {}

    public function trigger(Request $request, string $id): JsonResponse
    {
        $booking = \App\Models\Booking::where('customer_id', $request->user()->id)
            ->where('status', '!=', 'completed')
            ->where('status', '!=', 'cancelled')
            ->findOrFail($id);

        $alert = $this->sosService->triggerSOS($booking->id, $request->user()->id);

        return response()->json([
            'data' => $alert,
            'message' => 'SOS alert triggered. Emergency contacts have been notified.',
        ], 201);
    }

    public function deactivate(Request $request, string $id): JsonResponse
    {
        \App\Models\Booking::where('customer_id', $request->user()->id)->findOrFail($id);

        $this->sosService->deactivateSOS($id);

        return response()->json([
            'message' => 'SOS alert deactivated.',
        ]);
    }
}
