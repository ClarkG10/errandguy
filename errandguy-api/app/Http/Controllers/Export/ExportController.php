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

        [$rangeStart, $rangeEnd] = $this->applyPeriod($query, $request, $period);

        $agg = $query->selectRaw('COALESCE(SUM(runner_payout), 0) as sum_payout, COUNT(*) as cnt')->first();
        $totalEarnings = (float) ($agg->sum_payout ?? 0);
        $totalErrands = (int) ($agg->cnt ?? 0);
        $avgPerErrand = $totalErrands > 0 ? round($totalEarnings / $totalErrands, 2) : 0;

        // Line items for the statement table.
        $lineItems = $user->runnerBookings()
            ->completed()
            ->when($period === 'today', fn ($q) => $q
                ->where('completed_at', '>=', now()->startOfDay())
                ->where('completed_at', '<', now()->copy()->addDay()->startOfDay()))
            ->when($period === 'this_week', fn ($q) => $q
                ->where('completed_at', '>=', now()->startOfWeek())
                ->where('completed_at', '<=', now()->endOfWeek()))
            ->when($period === 'this_month', fn ($q) => $q
                ->where('completed_at', '>=', now()->startOfMonth())
                ->where('completed_at', '<', now()->copy()->startOfMonth()->addMonth()))
            ->when($period === 'custom' && $request->filled('date_from'), fn ($q) => $q
                ->where('completed_at', '>=', \Carbon\Carbon::parse($request->input('date_from'))->startOfDay()))
            ->when($period === 'custom' && $request->filled('date_to'), fn ($q) => $q
                ->where('completed_at', '<=', \Carbon\Carbon::parse($request->input('date_to'))->endOfDay()))
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
     * Applies the same date-range filtering as RunnerEarningsController::summary
     * and returns the resolved [start, end] for display on the statement.
     */
    private function applyPeriod($query, Request $request, string $period): array
    {
        switch ($period) {
            case 'today':
                $start = now()->startOfDay();
                $end = now()->copy()->addDay()->startOfDay();
                $query->where('completed_at', '>=', $start)
                      ->where('completed_at', '<', $end);
                return [$start, now()];
            case 'this_week':
                $start = now()->startOfWeek();
                $end = now()->endOfWeek();
                $query->where('completed_at', '>=', $start)
                      ->where('completed_at', '<=', $end);
                return [$start, $end];
            case 'this_month':
                $start = now()->startOfMonth();
                $end = now()->copy()->startOfMonth()->addMonth();
                $query->where('completed_at', '>=', $start)
                      ->where('completed_at', '<', $end);
                return [$start, now()];
            case 'custom':
                $start = $request->filled('date_from')
                    ? \Carbon\Carbon::parse($request->input('date_from'))->startOfDay()
                    : null;
                $end = $request->filled('date_to')
                    ? \Carbon\Carbon::parse($request->input('date_to'))->endOfDay()
                    : null;
                if ($start) {
                    $query->where('completed_at', '>=', $start);
                }
                if ($end) {
                    $query->where('completed_at', '<=', $end);
                }
                return [$start, $end];
        }

        return [null, null];
    }
}
