<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Http\Resources\BookingResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

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

        $bookings = $query->orderByDesc('created_at')->paginate(20)
            // Drop the large jsonb blobs (item_photos, shopping_items) from the
            // LIST view — they're detail-screen data that bloat every row.
            // makeHidden keeps every OTHER column, so no admin table cell is
            // blanked (a fuller column projection needs validation against the
            // admin UI first — see audit P39). ->through preserves pagination.
            ->through(fn (Booking $b) => $b->makeHidden(['item_photos', 'shopping_items']));

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

    public function cancel(Request $request, string $id, \App\Services\BookingService $bookings): JsonResponse
    {
        $request->validate(['reason' => 'required|string|max:500']);

        try {
            // Single money-safe path (raw status write + full wallet refund,
            // no fee) shared with the Filament admin panel.
            $bookings->adminCancel($id, $request->user()->id, $request->input('reason'));
        } catch (\App\Exceptions\BookingStateException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['message' => 'Booking cancelled by admin']);
    }
}
