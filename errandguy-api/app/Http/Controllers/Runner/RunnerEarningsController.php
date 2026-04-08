<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Http\Resources\EarningsResource;
use App\Models\SystemConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RunnerEarningsController extends Controller
{
    public function summary(Request $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        if (!$profile) {
            return response()->json([
                'message' => 'Runner profile not found.',
            ], 404);
        }

        $period = $request->input('period', 'today');

        $query = $user->runnerBookings()->completed();

        switch ($period) {
            case 'today':
                $query->whereDate('completed_at', today());
                break;
            case 'this_week':
                $query->whereBetween('completed_at', [now()->startOfWeek(), now()->endOfWeek()]);
                break;
            case 'this_month':
                $query->whereMonth('completed_at', now()->month)
                      ->whereYear('completed_at', now()->year);
                break;
            case 'custom':
                if ($request->filled('date_from')) {
                    $query->whereDate('completed_at', '>=', $request->input('date_from'));
                }
                if ($request->filled('date_to')) {
                    $query->whereDate('completed_at', '<=', $request->input('date_to'));
                }
                break;
        }

        $totalEarnings = (float) $query->sum('runner_payout');
        $totalErrands = $query->count();
        $avgPerErrand = $totalErrands > 0 ? round($totalEarnings / $totalErrands, 2) : 0;

        $data = [
            'period' => $period,
            'total_earnings' => $totalEarnings,
            'total_errands' => $totalErrands,
            'avg_per_errand' => $avgPerErrand,
            'acceptance_rate' => (float) $profile->acceptance_rate,
            'completion_rate' => (float) $profile->completion_rate,
            'online_hours' => null, // Estimated from location data if needed
        ];

        return response()->json([
            'data' => new EarningsResource($data),
        ]);
    }

    public function history(Request $request): JsonResponse
    {
        $query = $request->user()
            ->runnerBookings()
            ->completed()
            ->with(['errandType', 'customer'])
            ->orderByDesc('completed_at');

        if ($request->filled('errand_type_id')) {
            $query->where('errand_type_id', $request->input('errand_type_id'));
        }

        if ($request->filled('date_from')) {
            $query->whereDate('completed_at', '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('completed_at', '<=', $request->input('date_to'));
        }

        $bookings = $query->paginate($request->integer('per_page', 15));

        return response()->json(
            BookingResource::collection($bookings)->response()->getData(true)
        );
    }
}
