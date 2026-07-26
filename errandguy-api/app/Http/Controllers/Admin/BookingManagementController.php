<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Http\Resources\BookingResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

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
            // Sargable half-open range instead of whereDate() (DATE(created_at)=?
            // is non-sargable and defeats idx_bookings_created_at). app.tz=UTC and
            // created_at is stored UTC, matching the prior whereDate() boundary.
            $start = Carbon::parse($date)->startOfDay();
            $query->where('created_at', '>=', $start)
                  ->where('created_at', '<', $start->copy()->addDay());
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
            'reviews',
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
            // cancelled_by is a uuid column — binding the literal 'admin' threw
            // SQLSTATE 22P02 on Postgres, 500-ing every admin cancel (SQLite
            // tests silently accepted it). Record the acting admin's real id.
            'cancelled_by' => $request->user()->id,
            'cancellation_reason' => $request->input('reason'),
        ]);

        // Don't leave the assigned runner's GPS pings tagged to the cancelled
        // booking for the next ~30s (per-runner active-booking cache).
        if ($booking->runner_id) {
            Cache::forget("runner_active_booking_id:{$booking->runner_id}");
        }

        // An admin/platform-initiated cancel is not the customer's fault, so a
        // paid booking is refunded IN FULL with no cancellation fee (unlike the
        // customer-initiated cancel). refundUnfulfilled is the shared
        // full-refund-no-fee primitive (idempotent; no-op for cash/unpaid).
        app(\App\Services\BookingService::class)
            ->refundUnfulfilled($booking->id, 'Admin cancelled the booking');

        return response()->json(['message' => 'Booking cancelled by admin']);
    }
}
