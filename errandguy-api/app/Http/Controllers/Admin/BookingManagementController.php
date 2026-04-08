<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Http\Resources\BookingResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BookingManagementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Booking::with(['customer:id,full_name,phone', 'runner:id,full_name,phone']);

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('booking_number', 'ilike', "%{$search}%")
                  ->orWhereHas('customer', fn ($q2) => $q2->where('full_name', 'ilike', "%{$search}%"));
            });
        }

        if ($date = $request->query('date')) {
            $query->whereDate('created_at', $date);
        }

        $bookings = $query->orderByDesc('created_at')->paginate(20);

        return response()->json($bookings);
    }

    public function show(string $id): JsonResponse
    {
        $booking = Booking::with([
            'customer:id,full_name,email,phone,avatar_url',
            'runner:id,full_name,email,phone,avatar_url',
            'statusLogs',
            'review',
            'payment',
        ])->findOrFail($id);

        return response()->json(['data' => new BookingResource($booking)]);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $request->validate(['reason' => 'required|string|max:500']);

        $booking = Booking::findOrFail($id);

        if (in_array($booking->status, ['completed', 'cancelled'])) {
            return response()->json(['message' => 'Booking already finalized'], 422);
        }

        $booking->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'cancelled_by' => 'admin',
            'cancellation_reason' => $request->input('reason'),
        ]);

        return response()->json(['message' => 'Booking cancelled by admin']);
    }
}
