<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RunnerErrandHistoryController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = $request->user()
            ->runnerBookings()
            ->with(['errandType', 'customer', 'review'])
            ->whereIn('status', ['completed', 'cancelled'])
            ->orderByDesc('created_at');

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->filled('errand_type_id')) {
            $query->where('errand_type_id', $request->input('errand_type_id'));
        }

        if ($request->filled('date_from')) {
            $query->whereDate('created_at', '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('created_at', '<=', $request->input('date_to'));
        }

        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function ($q) use ($search) {
                $q->where('booking_number', 'ilike', "%{$search}%")
                  ->orWhereHas('customer', function ($cq) use ($search) {
                      $cq->where('full_name', 'ilike', "%{$search}%");
                  });
            });
        }

        $bookings = $query->paginate($request->integer('per_page', 15));

        return response()->json(
            BookingResource::collection($bookings)->response()->getData(true)
        );
    }
}
