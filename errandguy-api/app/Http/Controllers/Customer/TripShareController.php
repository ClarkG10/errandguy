<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class TripShareController extends Controller
{
    public function share(Request $request, string $id): JsonResponse
    {
        $booking = Booking::where('customer_id', $request->user()->id)
            ->where('status', '!=', 'completed')
            ->where('status', '!=', 'cancelled')
            ->findOrFail($id);

        $token = Str::random(64);

        $booking->update([
            'trip_share_token' => $token,
            'trip_share_active' => true,
        ]);

        $link = config('app.url') . "/trip/{$token}";

        return response()->json([
            'data' => [
                'link' => $link,
                'token' => $token,
            ],
        ]);
    }

    public function revoke(Request $request, string $id): JsonResponse
    {
        $booking = Booking::where('customer_id', $request->user()->id)->findOrFail($id);

        $booking->update([
            'trip_share_token' => null,
            'trip_share_active' => false,
        ]);

        return response()->json([
            'message' => 'Trip sharing has been stopped.',
        ]);
    }
}
