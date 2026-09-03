<?php

namespace App\Http\Controllers\Export;

use App\Http\Controllers\Controller;
use App\Models\Payment;
use App\Models\RunnerProfile;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ExportController extends Controller
{
    /**
     * GET /runner/earnings/export — a printable PDF earnings statement.
     *
     * Mirrors RunnerEarningsController::summary aggregation (period /
     * date_from / date_to) so the exported figures match the in-app
     * summary screen exactly. Returns a binary PDF download — an
     * intentional exception to the JSON envelope convention.
     */
    public function earningsPdf(Request $request): Response
    {
        // Guard custom-range dates so bad input is a 422, not a Carbon 500.
        $request->validate([
            'period' => ['nullable', 'string', 'max:20'],
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

        // Resolve the window ONCE — the header aggregate and the itemised rows
        // below both filter on it, so they cannot describe different periods
        // (and cannot straddle a midnight that falls between two now() calls).
        [$windowStart, $windowEnd] = $this->periodWindow($request, $period);
        $this->applyWindow($query, $windowStart, $windowEnd);
        [$rangeStart, $rangeEnd] = $this->displayRange($period, $windowStart, $windowEnd);

        // Tips are aggregated separately and printed as their own line — never
        // added into the payout total, which is the figure commission and
        // settlement reconcile against. Keeps the PDF agreeing with the
        // Earnings screen, which shows the same two figures side by side.
        $agg = $query->selectRaw(
            'COALESCE(SUM(runner_payout), 0) as sum_payout, COALESCE(SUM(tip_amount), 0) as sum_tips, COUNT(*) as cnt'
        )->first();
        $totalEarnings = (float) ($agg->sum_payout ?? 0);
        $totalTips = (float) ($agg->sum_tips ?? 0);
        $totalErrands = (int) ($agg->cnt ?? 0);
        $avgPerErrand = $totalErrands > 0 ? round($totalEarnings / $totalErrands, 2) : 0;

        // Line items for the statement table — same window as the aggregate.
        $lineItems = $user->runnerBookings()
            ->completed()
            ->when($windowStart, fn ($q) => $q->where('completed_at', '>=', $windowStart))
            ->when($windowEnd, fn ($q) => $q->where('completed_at', '<', $windowEnd))
            ->with('errandType:id,name')
            ->orderByDesc('completed_at')
            ->limit(500)
            ->get();

        $data = [
            'runner' => [
                'name' => $user->full_name,
                'phone' => $user->phone,
            ],
            'period' => $period,
            'range_start' => $rangeStart,
            'range_end' => $rangeEnd,
            'total_earnings' => $totalEarnings,
            'total_tips' => $totalTips,
            'total_errands' => $totalErrands,
            'avg_per_errand' => $avgPerErrand,
            'line_items' => $lineItems,
            // Header totals are the full-period aggregate, but the itemised table
            // is capped at 500 rows (DomPDF OOMs/times-out on thousands). When the
            // period has more errands than that, disclose it so the rows-vs-total
            // gap reads as "showing recent 500", not a statement that fails to
            // reconcile.
            'line_item_cap' => 500,
            'line_items_truncated' => $totalErrands > $lineItems->count(),
            'generated_at' => now(),
        ];

        return Pdf::loadView('pdf.earnings-statement', $data)->download('earnings.pdf');
    }

    /**
     * GET /payments/{id}/receipt/pdf — a printable PDF receipt for a payment
     * the caller owns. Reuses PaymentHistoryController::receipt data shape.
     */
    public function receiptPdf(Request $request, string $id): Response
    {
        $payment = Payment::where('customer_id', $request->user()->id)
            ->with(['booking.errandType', 'booking.runner'])
            ->findOrFail($id);

        $data = [
            'payment' => $payment,
            'booking' => [
                'booking_number' => $payment->booking->booking_number ?? null,
                'errand_type' => $payment->booking->errandType->name ?? null,
                'pickup_address' => $payment->booking->pickup_address ?? null,
                'dropoff_address' => $payment->booking->dropoff_address ?? null,
                'runner_name' => $payment->booking->runner->full_name ?? null,
                'completed_at' => $payment->booking->completed_at ?? null,
            ],
            'generated_at' => now(),
        ];

        return Pdf::loadView('pdf.receipt', $data)->download('receipt.pdf');
    }

    /**
     * The same date-range filtering RunnerEarningsController::summary applies,
     * on the resolved half-open UTC window.
     *
     * @param  \Illuminate\Database\Eloquent\Builder<\App\Models\Booking>  $query
     */
    private function applyWindow($query, ?\Carbon\CarbonInterface $start, ?\Carbon\CarbonInterface $end): void
    {
        if ($start) {
            $query->where('completed_at', '>=', $start);
        }
        if ($end) {
            $query->where('completed_at', '<', $end);
        }
    }

    /**
     * The [start, end] pair printed at the top of the statement. The filter
     * runs on UTC boundaries (that is what completed_at stores) but the printed
     * range is rendered in the business timezone, so a statement for "today" is
     * headed with the Manila date the runner asked for rather than the UTC
     * instant its window happens to begin at (16:00 the previous day).
     *
     * @return array{0: ?\Carbon\CarbonInterface, 1: ?\Carbon\CarbonInterface}
     */
    private function displayRange(string $period, ?\Carbon\CarbonInterface $start, ?\Carbon\CarbonInterface $end): array
    {
        $tz = self::businessTz();
        $localStart = $start?->copy()->timezone($tz);

        return match ($period) {
            // An in-progress period reads "<start> – now", as it did before.
            'today', 'this_month' => [$localStart, now($tz)],
            // A closed window is half-open [start, end); the last moment a row
            // can land on is a tick before `end`, and that is the date that
            // belongs on paper — not the following Monday / next day.
            'this_week', 'custom' => [$localStart, $end?->copy()->timezone($tz)->subSecond()],
            default => [null, null],
        };
    }

    /**
     * The period as a half-open UTC window [start, end), with the boundaries
     * falling on the BUSINESS calendar — a runner's "today" is a Manila day,
     * not the 08:00-to-08:00 Manila slice a bare now()->startOfDay() produced.
     * Mirrors RunnerEarningsController::namedWindow / ::customWindow so the PDF
     * and the Earnings screen can never disagree about which errands are in.
     *
     * @return array{0: ?\Carbon\CarbonInterface, 1: ?\Carbon\CarbonInterface}
     */
    private function periodWindow(Request $request, string $period): array
    {
        $tz = self::businessTz();

        if ($period === 'custom') {
            return [
                $request->filled('date_from')
                    ? \Carbon\Carbon::parse($request->input('date_from'), $tz)->startOfDay()->utc()
                    : null,
                $request->filled('date_to')
                    ? \Carbon\Carbon::parse($request->input('date_to'), $tz)->startOfDay()->addDay()->utc()
                    : null,
            ];
        }

        $start = now($tz);

        switch ($period) {
            case 'today':
                $start->startOfDay();
                $end = $start->copy()->addDay();
                break;
            case 'this_week':
                $start->startOfWeek();
                $end = $start->copy()->addWeek();
                break;
            case 'this_month':
                $start->startOfMonth();
                $end = $start->copy()->addMonth();
                break;
            default:
                return [null, null];
        }

        return [$start->utc(), $end->utc()];
    }

    /** The wall clock a runner's calendar boundaries are read on (PH = UTC+8). */
    private static function businessTz(): string
    {
        return (string) config('app.business_timezone', 'Asia/Manila');
    }
}
