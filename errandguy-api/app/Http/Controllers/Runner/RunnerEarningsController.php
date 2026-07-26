<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Http\Resources\EarningsResource;
use App\Models\RunnerProfile;
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
        $this->applyPeriodRange($query, $period, $request);
        $agg = $this->aggregateEarnings($query);

        $data = [
            'period' => $period,
            'total_earnings' => $agg['total_earnings'],
            'total_errands' => $agg['total_errands'],
            'avg_per_errand' => $agg['avg_per_errand'],
            'acceptance_rate' => (float) $profile->acceptance_rate,
            'completion_rate' => (float) $profile->completion_rate,
            'online_hours' => null, // Estimated from location data if needed
        ];

        return response()->json([
            'data' => new EarningsResource($data),
        ]);
    }

    /**
     * GET /runner/earnings/overview — today + this_week + this_month in ONE
     * response.
     *
     * The runner home hero + the login preload previously fired THREE separate
     * /earnings requests to build this; one round-trip warms all three, removing
     * ~2 cold-start requests and a second source of the hero flash. Reuses
     * applyPeriodRange() + aggregateEarnings() with summary() so the two
     * endpoints can never drift. (P9)
     */
    public function overview(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user->runnerProfile) {
            RunnerProfile::create([
                'user_id' => $user->id,
                'verification_status' => 'pending',
            ]);
        }

        $out = [];
        foreach (['today', 'this_week', 'this_month'] as $p) {
            $query = $user->runnerBookings()->completed();
            $this->applyPeriodRange($query, $p, $request);
            $out[$p] = $this->aggregateEarnings($query);
        }

        return response()->json(['data' => $out]);
    }

    /**
     * Apply the completed_at date range for a period to an earnings query.
     * Sargable range comparisons (not whereDate/whereMonth) so the completed_at
     * index is usable. Shared by summary() and overview(). (P9)
     */
    private function applyPeriodRange($query, string $period, Request $request): void
    {
        switch ($period) {
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
            case 'custom':
                if ($request->filled('date_from')) {
                    $query->where('completed_at', '>=', \Carbon\Carbon::parse($request->input('date_from'))->startOfDay());
                }
                if ($request->filled('date_to')) {
                    $query->where('completed_at', '<=', \Carbon\Carbon::parse($request->input('date_to'))->endOfDay());
                }
                break;
        }
    }

    /**
     * Single aggregate (SUM + COUNT) → {total_earnings, total_errands,
     * avg_per_errand}. Shared by summary() and overview() so the money math is
     * defined once. (P9)
     */
    private function aggregateEarnings($query): array
    {
        $agg = $query->selectRaw('COALESCE(SUM(runner_payout), 0) as sum_payout, COUNT(*) as cnt')->first();
        $total = (float) ($agg->sum_payout ?? 0);
        $count = (int) ($agg->cnt ?? 0);

        return [
            'total_earnings' => $total,
            'total_errands' => $count,
            'avg_per_errand' => $count > 0 ? round($total / $count, 2) : 0,
        ];
    }

    public function history(Request $request): JsonResponse
    {
        // Guard the date filters against a Carbon::parse 500 on bad input.
        $request->validate([
            'errand_type_id' => ['nullable'],
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

        if ($request->filled('date_from')) {
            $query->where('completed_at', '>=', \Carbon\Carbon::parse($request->input('date_from'))->startOfDay());
        }

        if ($request->filled('date_to')) {
            $query->where('completed_at', '<=', \Carbon\Carbon::parse($request->input('date_to'))->endOfDay());
        }

        $bookings = $query->paginate($request->perPage(15));

        return response()->json(
            BookingResource::collection($bookings)->response()->getData(true)
        );
    }
}
