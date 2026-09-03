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
        // index usage on completed_at. An unrecognised period stays
        // unfiltered (lifetime), exactly as before.
        $this->applyWindow($query, match ($period) {
            'today', 'this_week', 'this_month' => $this->namedWindow($period),
            'custom' => $this->customWindow($request),
            default => [null, null],
        });

        // Single aggregate query instead of separate sum() + count().
        // Tips are summed ALONGSIDE the payout, never into it: runner_payout is
        // what the cash-settlement commission maths and the PDF statement
        // reconcile against, so folding tips in would corrupt both. The runner
        // was told about each tip by push and then never saw it again on this
        // screen — the headline simply read lower than what hit their wallet.
        $agg = $query->selectRaw(
            'COALESCE(SUM(runner_payout), 0) as sum_payout, COALESCE(SUM(tip_amount), 0) as sum_tips, COUNT(*) as cnt'
        )->first();
        $totalEarnings = (float) ($agg->sum_payout ?? 0);
        $totalTips = (float) ($agg->sum_tips ?? 0);
        $totalErrands = (int) ($agg->cnt ?? 0);
        $avgPerErrand = $totalErrands > 0 ? round($totalEarnings / $totalErrands, 2) : 0;

        $data = [
            'period' => $period,
            'total_earnings' => $totalEarnings,
            // Bucketed by the errand's completed_at, so a tip that lands days
            // later counts in the period the errand was run.
            'total_tips' => $totalTips,
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

        // Period window — resolved by the SAME helpers as summary() so the
        // per-errand list matches the hero total exactly (a client-local
        // date_from would drift by the runner's UTC offset and pull in a whole
        // extra day of rows that don't sum to the hero). A known period wins;
        // otherwise the explicit date_from/date_to bounds are honored (custom
        // ranges / any other caller), unchanged from before.
        $period = (string) $request->input('period');
        $this->applyWindow($query, match ($period) {
            'today', 'this_week', 'this_month' => $this->namedWindow($period),
            default => $this->customWindow($request),
        });

        $bookings = $query->paginate($request->perPage(15));

        return response()->json(
            BookingResource::collection($bookings)->response()->getData(true)
        );
    }

    /**
     * Resolve 'today' / 'this_week' / 'this_month' into a half-open UTC window
     * [start, end) whose boundaries fall on the BUSINESS calendar.
     *
     * completed_at is stored in UTC and config('app.timezone') deliberately
     * stays UTC — flipping it would move every now() in the codebase at once
     * (scheduler windows, offer deadlines, reaper thresholds) for a display
     * bug. But a runner's "today" is a Manila day. Computed with a bare now(),
     * "today" ran 08:00 Manila → 08:00 Manila: a runner who started at 6am
     * watched the hero figure and the daily-goal bar snap back to zero
     * mid-shift while the errands they had already finished moved into
     * "yesterday" — and "this week" had the same seam on Monday morning. So
     * bucket in the business timezone and convert the two boundaries back to
     * UTC for the (still sargable) comparison.
     *
     * @return array{0: \Carbon\CarbonInterface, 1: \Carbon\CarbonInterface}
     */
    private function namedWindow(string $period): array
    {
        // startOfX in local time, then advance in local time, THEN convert to
        // UTC: correct even for a business timezone that observes DST (PH does
        // not, but the boundary maths should not depend on that).
        $start = now(self::businessTz());

        switch ($period) {
            case 'this_week':
                $start->startOfWeek();
                $end = $start->copy()->addWeek();
                break;
            case 'this_month':
                $start->startOfMonth();
                $end = $start->copy()->addMonth();
                break;
            default:
                $start->startOfDay();
                $end = $start->copy()->addDay();
                break;
        }

        return [$start->utc(), $end->utc()];
    }

    /**
     * Explicit date_from / date_to bounds as a half-open UTC window. The dates
     * a client sends are business-calendar dates, so date_to=2026-09-02 has to
     * include an errand completed 23:30 that evening in Manila — which a UTC
     * end-of-day would have dropped into the next window.
     *
     * @return array{0: ?\Carbon\CarbonInterface, 1: ?\Carbon\CarbonInterface}
     */
    private function customWindow(Request $request): array
    {
        $tz = self::businessTz();

        return [
            $request->filled('date_from')
                ? \Carbon\Carbon::parse($request->input('date_from'), $tz)->startOfDay()->utc()
                : null,
            $request->filled('date_to')
                ? \Carbon\Carbon::parse($request->input('date_to'), $tz)->startOfDay()->addDay()->utc()
                : null,
        ];
    }

    /**
     * @param  \Illuminate\Database\Eloquent\Builder<\App\Models\Booking>  $query
     * @param  array{0: ?\Carbon\CarbonInterface, 1: ?\Carbon\CarbonInterface}  $window
     */
    private function applyWindow($query, array $window): void
    {
        [$start, $end] = $window;

        if ($start) {
            $query->where('completed_at', '>=', $start);
        }
        if ($end) {
            // Half-open on purpose: no row can fall in two windows, and no
            // sub-second row at the boundary can fall in neither.
            $query->where('completed_at', '<', $end);
        }
    }

    /** The wall clock a runner's calendar boundaries are read on (PH = UTC+8). */
    private static function businessTz(): string
    {
        return (string) config('app.business_timezone', 'Asia/Manila');
    }
}
