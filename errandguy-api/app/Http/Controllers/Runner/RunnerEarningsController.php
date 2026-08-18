<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Http\Resources\EarningsResource;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RunnerEarningsController extends Controller
{
    public function summary(Request $request): JsonResponse
    {
        // Validate the custom-range dates so a malformed value returns 422, not
        // an uncaught Carbon::parse InvalidFormatException -> 500 (matches the
        // guard already on WalletController::transactions / BookingController::index).
        $request->validate([
            'period' => ['nullable', 'string', 'max:30'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
        ]);

        $user = $request->user();
        $profile = $user->runnerProfile;

        if (!$profile) {
            $profile = RunnerProfile::create([
                'user_id' => $user->id,
                'verification_status' => 'pending',
            ]);
        }

        $period = $request->input('period', 'today');

        $query = $user->runnerBookings()->completed();

        // Use date-range comparisons (sargable) instead of whereDate /
        // whereMonth which wrap the column in a function and prevent
        // index usage on completed_at.
        switch ($period) {
            case 'today':
                $start = now()->startOfDay();
                $end = now()->copy()->addDay()->startOfDay();
                $query->where('completed_at', '>=', $start)
                      ->where('completed_at', '<', $end);
                break;
            case 'this_week':
                $query->where('completed_at', '>=', now()->startOfWeek())
                      ->where('completed_at', '<=', now()->endOfWeek());
                break;
            case 'this_month':
                $query->where('completed_at', '>=', now()->startOfMonth())
                      ->where('completed_at', '<', now()->copy()->startOfMonth()->addMonth());
                break;
            case 'custom':
                if ($request->filled('date_from')) {
                    $query->where('completed_at', '>=', \Carbon\Carbon::parse($request->input('date_from'))->startOfDay());
                }
                if ($request->filled('date_to')) {
                    $query->where('completed_at', '<=', \Carbon\Carbon::parse($request->input('date_to'))->endOfDay());
                }
                break;
        }

        // Single aggregate query instead of separate sum() + count().
        $agg = $query->selectRaw('COALESCE(SUM(runner_payout), 0) as sum_payout, COUNT(*) as cnt')->first();
        $totalEarnings = (float) ($agg->sum_payout ?? 0);
        $totalErrands = (int) ($agg->cnt ?? 0);
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
        // Guard the date filters against a Carbon::parse 500 on bad input.
        $request->validate([
            'errand_type_id' => ['nullable'],
            'period' => ['nullable', 'string', 'max:30'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
        ]);

        $query = $request->user()
            ->runnerBookings()
            ->completed()
            ->with([
                'errandType',
                'customer:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
            ])
            ->orderByDesc('completed_at');

        if ($request->filled('errand_type_id')) {
            $query->where('errand_type_id', $request->input('errand_type_id'));
        }

        // Period window — UTC, IDENTICAL to summary() so the per-errand list
        // matches the hero total exactly. A client-local date_from would drift
        // by the runner's UTC offset (e.g. PH = +8) and pull in a whole extra
        // day of rows that don't sum to the hero. A known period wins; otherwise
        // the explicit date_from/date_to bounds are honored (custom ranges /
        // any other caller), unchanged from before.
        switch ($request->input('period')) {
            case 'today':
                $query->where('completed_at', '>=', now()->startOfDay())
                      ->where('completed_at', '<', now()->copy()->addDay()->startOfDay());
                break;
            case 'this_week':
                $query->where('completed_at', '>=', now()->startOfWeek())
                      ->where('completed_at', '<=', now()->endOfWeek());
                break;
            case 'this_month':
                $query->where('completed_at', '>=', now()->startOfMonth())
                      ->where('completed_at', '<', now()->copy()->startOfMonth()->addMonth());
                break;
            default:
                if ($request->filled('date_from')) {
                    $query->where('completed_at', '>=', \Carbon\Carbon::parse($request->input('date_from'))->startOfDay());
                }
                if ($request->filled('date_to')) {
                    $query->where('completed_at', '<=', \Carbon\Carbon::parse($request->input('date_to'))->endOfDay());
                }
                break;
        }

        $bookings = $query->paginate($request->perPage(15));

        return response()->json(
            BookingResource::collection($bookings)->response()->getData(true)
        );
    }
}
