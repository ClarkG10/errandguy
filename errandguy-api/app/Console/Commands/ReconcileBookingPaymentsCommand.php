<?php

namespace App\Console\Commands;

use App\Enums\PaymentStatus;
use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\Payment;
use App\Services\PaymentService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Settle booking charges the gateway resolved but no webhook ever told us about.
 *
 * Top-ups and payouts each got a scheduled sweep for exactly this failure. The
 * booking charge — the PRIMARY revenue path — had none. Its only pull-reconcile
 * happens on the customer's status poll, which is not durable: the app stops
 * polling the moment they dismiss the pending sheet, and the stored attempt is
 * dropped after 6h. So when a webhook is delayed or dropped and the customer
 * walks away, nothing on either side reconciles the charge.
 *
 * Both directions of that leak cost real money:
 *   • a genuinely PAID booking stuck at 'pending' → completion credits the
 *     runner ₱0 (handleCompletion takes neither the paid nor the cash branch),
 *     and the back-fill that would fix it is only reachable from the webhook or
 *     the poll;
 *   • an ABANDONED checkout stays live → the runner works an errand nobody paid
 *     for (AutoCancelBookingJob and the stranded-booking reaper both only look at
 *     'pending'/'no_runner', so an accepted booking is invisible to them).
 *
 * This reuses PaymentService::reconcileBookingPayment, so there is exactly ONE
 * settlement path shared with the polling endpoint — row-locked, idempotent, and
 * only ever moving a charge to the state the gateway itself reports. Settling it
 * here also runs the same post-commit seams the poll does: back-fill the runner's
 * earning on success, tear the booking down on failure/expiry.
 *
 * Second job: a cheap DETECTIVE control. Any booking that reached 'completed'
 * without its money is a service delivered for free, and no existing check can
 * see it (reconcile-wallets only asserts balance == ledger). One query surfaces
 * the whole family.
 */
class ReconcileBookingPaymentsCommand extends Command
{
    protected $signature = 'errandguy:reconcile-booking-payments
        {--min-age=5 : Only consider charges older than this many minutes (gives the webhook first refusal)}
        {--max-age=7 : Ignore charges older than this many days (long past any gateway payment window)}
        {--limit=200 : Max charges examined per run (bounds gateway calls per sweep)}
        {--dry-run : Report what would be reconciled without settling anything}';

    protected $description = 'Reconcile pending booking charges against the payment gateway, and flag completed-but-unpaid errands';

    public function handle(PaymentService $payments): int
    {
        $minAgeMinutes = max(1, (int) $this->option('min-age'));
        $maxAgeDays = max(1, (int) $this->option('max-age'));
        $limit = max(1, (int) $this->option('limit'));
        $dryRun = (bool) $this->option('dry-run');

        // Oldest first: the charge stranded longest is the one whose customer or
        // runner has been waiting longest, and the closest to the gateway's own
        // expiry, after which the truth stops being retrievable.
        $pending = Payment::query()
            ->whereIn('status', [PaymentStatus::Pending->value, PaymentStatus::Processing->value])
            ->whereNotNull('booking_id')
            ->whereNotNull('gateway_tx_id')
            ->whereNotIn('method', ['cash', 'wallet'])
            ->where('created_at', '<=', now()->subMinutes($minAgeMinutes))
            ->where('created_at', '>=', now()->subDays($maxAgeDays))
            ->orderBy('created_at')
            ->limit($limit)
            ->get();

        $settled = 0;
        $closed = 0;
        $stillPending = 0;

        if ($pending->isEmpty()) {
            $this->info('No pending booking charges to reconcile.');
        } else {
            $this->info("Examining {$pending->count()} pending booking charge(s)…");

            foreach ($pending as $payment) {
                if ($dryRun) {
                    $this->line("  would pull {$payment->id} (₱{$payment->amount}, ref {$payment->gateway_tx_id})");

                    continue;
                }

                // Throttle 0 — see the note in reconcileBookingPayment; nobody is
                // polling these, which is the whole reason they are stranded.
                $result = $payments->reconcileBookingPayment($payment, 0);

                match ($result->status) {
                    PaymentStatus::Completed->value => $settled++,
                    PaymentStatus::Failed->value, PaymentStatus::Expired->value => $closed++,
                    default => $stillPending++,
                };

                if ($result->status === PaymentStatus::Completed->value) {
                    // The webhook should have done this. One is a blip; a pattern
                    // is a webhook-delivery problem worth investigating.
                    Log::warning('Booking charge settled by sweep, not webhook', [
                        'payment_id' => $payment->id,
                        'booking_id' => $payment->booking_id,
                        'stranded_minutes' => (int) $payment->created_at->diffInMinutes(now()),
                    ]);

                    AdminAlert::raise(
                        'booking_payment_reconciled',
                        'warning',
                        'Booking charge settled by reconciliation sweep',
                        "A ₱{$payment->amount} booking charge was confirmed paid at the gateway but no webhook settled it. "
                            .'The runner earning has been back-filled. Repeated occurrences indicate a webhook-delivery problem.',
                        $payment->id,
                    );
                }
            }

            if ($dryRun) {
                $this->info('Dry run — nothing settled.');

                return self::SUCCESS;
            }

            $this->info("Settled: {$settled}  Closed as failed/expired: {$closed}  Still pending: {$stillPending}");
        }

        if (! $dryRun) {
            $this->flagCompletedButUnpaid();
        }

        return self::SUCCESS;
    }

    /**
     * Detective control: an errand that was DELIVERED but never paid for.
     *
     * Cash errands settle at completion by design, so they are excluded. Anything
     * else that reached 'completed' without landing on 'paid'/'refunded' means the
     * runner was credited nothing for work they actually did — the exact end state
     * every leak in this family produces, and one nothing else looks for.
     */
    private function flagCompletedButUnpaid(): void
    {
        $suspect = Booking::query()
            ->where('status', 'completed')
            ->whereNotIn('payment_status', ['paid', 'refunded'])
            ->where(function ($q) {
                $q->whereNull('payment_method')->orWhere('payment_method', '!=', 'cash');
            })
            ->orderBy('updated_at')
            ->limit(50)
            ->get(['id', 'booking_number', 'payment_status', 'payment_method', 'runner_id']);

        if ($suspect->isEmpty()) {
            $this->info('No completed-but-unpaid errands.');

            return;
        }

        $numbers = $suspect->pluck('booking_number')->take(10)->implode(', ');

        $this->error("{$suspect->count()} completed errand(s) with no settled payment: {$numbers}");

        Log::critical('Completed errands with unsettled payment', [
            'count' => $suspect->count(),
            'booking_numbers' => $suspect->pluck('booking_number')->take(10)->all(),
        ]);

        AdminAlert::raise(
            'completed_unpaid_booking',
            'critical',
            'Completed errands with no settled payment',
            "{$suspect->count()} errand(s) were delivered but their online charge never settled, so the runner was credited nothing: {$numbers}. "
                .'Check the gateway for each and settle or compensate manually.',
            $suspect->first()->id,
        );
    }
}
