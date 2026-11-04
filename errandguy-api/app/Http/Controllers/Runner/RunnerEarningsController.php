<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Http\Resources\EarningsResource;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use App\Support\AdminChartData;
use App\Support\BusinessDay;
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
        $this->applyWindow($query, $this->summaryWindow($request, $period));

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
            'completion_rate' => (float) $profile->completion_rate,
            'online_hours' => null, // Estimated from location data if needed
        ];

        return response()->json([
            'data' => new EarningsResource($data),
        ]);
    }

    /**
     * GET /runner/earnings/daily — the period's totals per Manila calendar day.
     *
     * The earnings tab used to build its day groups and its week chart from
     * the per-errand list, fetched as ONE page of up to 100 rows. A runner with
     * more completed errands than that in the month (or a busy week) silently
     * lost the oldest days from both — the day subtotals and the bars read
     * lower than what they earned, under a hero total that was right. So the
     * per-day sums now come from the database, over the WHOLE window, and the
     * list underneath is free to load a page at a time.
     *
     * Same window as summary() (same period values, same Manila boundaries),
     * so the days add up to the hero total. Each errand counts on the Manila
     * date of its completed_at: one finished 23:30 Manila is that day's, not
     * the next (UTC) day's. Days with no completed errand are left out.
     *
     * `cash_earnings` is how much of the day's payout was collected in cash at
     * the door (the rest went to the wallet). It is null when any of that day's
     * errands has no payment method on record — the app then shows no
     * cash/online split rather than a guess.
     */
    public function daily(Request $request): JsonResponse
    {
        $request->validate([
            'period' => ['nullable', 'string', 'max:30'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
        ]);

        $period = $request->input('period', 'today');

        $query = $request->user()->runnerBookings()->completed();
        $this->applyWindow($query, $this->summaryWindow($request, $period));

        // One GROUP BY over the window. The bucket shifts completed_at (UTC)
        // into Manila time before taking the date — the same expression the
        // admin charts use, written for MySQL and SQLite alike.
        $bucket = AdminChartData::dayBucket('completed_at');
        $rows = $query->toBase()
            ->selectRaw("{$bucket} as day")
            ->selectRaw('COUNT(*) as errands')
            ->selectRaw('COALESCE(SUM(runner_payout), 0) as earnings')
            ->selectRaw('COALESCE(SUM(tip_amount), 0) as tips')
            ->selectRaw("COALESCE(SUM(CASE WHEN LOWER(payment_method) = 'cash' THEN runner_payout ELSE 0 END), 0) as cash_earnings")
            ->selectRaw("SUM(CASE WHEN payment_method IS NULL OR payment_method = '' THEN 1 ELSE 0 END) as unknown_method")
            ->groupBy('day')
            ->orderByDesc('day')
            ->get();

        return response()->json([
            'data' => [
                'period' => $period,
                // The calendar the dates are on, so the app can put each
                // errand in its list under the same day as these totals.
                'timezone' => BusinessDay::timezone(),
                'utc_offset_minutes' => now(BusinessDay::timezone())->utcOffset(),
                'days' => $rows->map(fn ($row): array => [
                    'date' => (string) $row->day,
                    'errands' => (int) $row->errands,
                    // Payout only. Tips are reported beside it, never in it —
                    // the same rule as summary().
                    'earnings' => round((float) $row->earnings, 2),
                    'tips' => round((float) $row->tips, 2),
                    'cash_earnings' => (int) $row->unknown_method > 0
                        ? null
                        : round((float) $row->cash_earnings, 2),
                ])->values()->all(),
            ],
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
     * The window summary() and daily() total over. Shared so the per-day
     * figures can never cover a different stretch than the hero total.
     * Nullable on purpose: `?period=` arrives as null, and an unrecognised
     * period has always meant lifetime, never an error.
     *
     * @return array{0: ?\Carbon\CarbonInterface, 1: ?\Carbon\CarbonInterface}
     */
    private function summaryWindow(Request $request, ?string $period): array
    {
        return match ($period) {
            'today', 'this_week', 'this_month' => $this->namedWindow($period),
            'custom' => $this->customWindow($request),
            default => [null, null],
        };
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
