<?php

namespace App\Console\Commands;

use App\Enums\PaymentStatus;
use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\Payment;
use App\Services\BookingService;
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
 *   • a genuinely PAID GCash/Maya errand never starts matching (matching waits
 *     for the confirmed payment) and is cancelled once its payment window
 *     closes — the customer paid and got a wallet refund instead of the errand;
 *   • a payment that lands after its errand was cancelled must be refunded,
 *     which only a confirmation can trigger.
 *
 * This reuses PaymentService::reconcileBookingPayment, so there is exactly ONE
 * settlement path shared with the polling endpoint — row-locked, idempotent, and
 * only ever moving a charge to the state the gateway itself reports. Settling it
 * here also runs the same post-commit seams the poll does: start matching (or
 * refund a cancelled errand, or back-fill a runner's earning) on success, cancel
 * the errand on failure/expiry.
 *
 * It also starts matching for a paid errand whose search never began (the
 * confirming path died between recording the payment and starting matching),
 * and resumes one whose search was claimed but never ran (the process died
 * between stamping matching_started_at and the first sweep).
 *
 * Last, cheap DETECTIVE controls. Any booking that reached 'completed' without
 * its money is a service delivered for free. Payment now comes before any
 * runner is involved, so only an errand booked before that (or one a staff
 * refund un-paid mid-errand) can still get there — but no other check could
 * see it (reconcile-wallets only asserts balance == ledger), so the alert stays
 * as a backstop. One query surfaces the whole family.
 */
class ReconcileBookingPaymentsCommand extends Command
{
    protected $signature = 'errandguy:reconcile-booking-payments
        {--min-age=5 : Only consider charges older than this many minutes (gives the webhook first refusal)}
        {--max-age=7 : Ignore charges older than this many days (long past any gateway payment window)}
        {--limit=200 : Max charges examined per run (bounds gateway calls per sweep)}
        {--dry-run : Report what would be reconciled without settling anything}';

    protected $description = 'Reconcile pending booking charges against the payment gateway, and flag completed-but-unpaid errands';

    /**
     * The least time a claimed search may show no offer before it counts as
     * never having run. The real wait also covers the whole search ladder
     * (staff can stretch it to minutes), so a slow search isn't restarted.
     */
    private const STALLED_SEARCH_MINUTES = 3;

    /** How far back the charged-but-never-refunded check looks. */
    private const ORPHAN_LOOKBACK_DAYS = 30;

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
                            .'It is settled now (its errand matched, or refunded if it was already cancelled). '
                            .'Repeated occurrences indicate a webhook-delivery problem.',
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
            $this->startPaidButUnmatched($minAgeMinutes);
            $this->resumeSearchesThatNeverRan();
            $this->flagCompletedButUnpaid();
            $this->flagChargedButNeverRefunded();
        }

        return self::SUCCESS;
    }

    /**
     * Backstop: a GCash/Maya errand whose payment is confirmed but whose search
     * never started — the webhook or status check that confirmed it died before
     * matching began, and nobody is polling. Started through the same guarded
     * entry point every confirmation uses, so it can't start twice. A scheduled
     * errand that isn't due is left to errandguy:start-due-scheduled-matching.
     */
    private function startPaidButUnmatched(int $minAgeMinutes): void
    {
        $ids = Booking::query()
            ->where('status', 'pending')
            ->whereNull('runner_id')
            ->whereNull('matching_started_at')
            ->where('payment_status', 'paid')
            ->paysOnline()
            ->where('updated_at', '<=', now()->subMinutes($minAgeMinutes))
            ->orderBy('created_at')
            ->limit(50)
            ->pluck('id');

        $started = 0;
        foreach ($ids as $id) {
            try {
                if (app(BookingService::class)->startMatchingAfterPayment($id)) {
                    $started++;
                }
            } catch (\Throwable $e) {
                Log::error('Could not start matching for a paid errand', ['booking_id' => $id, 'error' => $e->getMessage()]);
            }
        }

        if ($started > 0) {
            Log::warning("Started matching for {$started} paid errand(s) whose search never began");
            $this->warn("Started matching for {$started} paid errand(s) whose search never began.");
        }
    }

    /**
     * Backstop: a paid errand whose search was claimed but never ran.
     *
     * Starting a search stamps matching_started_at and commits, and only then
     * arms the no-runner auto-cancel and runs the first sweep
     * (BookingService::beginMatching). A process that dies in between (deploy
     * restart, OOM) leaves the errand pending and paid with nothing searching
     * and no auto-cancel armed — and every other backstop, startPaidButUnmatched
     * above included, only looks at errands with matching_started_at still
     * NULL. The customer waited out the whole window for a wallet refund.
     *
     * Picked out by: pending, paid, no runner, never offered to anyone this
     * round (offer_count 0), its search claimed over STALLED_SEARCH_MINUTES
     * ago — longer than the instant search's whole re-sweep ladder (3 sweeps
     * 45 s apart) — and still inside its search window (past it, the
     * stranded-booking reaper cancels and refunds it). Scheduled errands are
     * left out: their search legitimately re-sweeps with no offers until the
     * window closes, and errandguy:start-due-scheduled-matching owns them.
     *
     * Resumed with beginMatching itself, which re-arms the auto-cancel and
     * runs a sweep; both are safe to repeat (the auto-cancel no-ops once the
     * errand leaves pending, and the sweep locks the row and only matches a
     * pending one). This sweep runs every 15 minutes and an errand whose
     * resumed search is answered (matched, or "no runner") leaves pending, so
     * at most one more sweep reaches an errand still waiting on its queued
     * re-sweeps — harmless, and bounded by its search window.
     */
    private function resumeSearchesThatNeverRan(): void
    {
        $stalledAfter = max(self::STALLED_SEARCH_MINUTES * 60, \App\Jobs\MatchRunnerJob::ladderSeconds() + 120);

        $bookings = Booking::query()
            ->where('status', 'pending')
            ->whereNull('runner_id')
            ->where('payment_status', 'paid')
            ->where('offer_count', 0)
            ->whereNotNull('matching_started_at')
            ->where('matching_started_at', '<=', now()->subSeconds($stalledAfter))
            ->where(fn ($q) => $q->where('schedule_type', '!=', 'scheduled')
                ->orWhereNull('schedule_type')
                ->orWhereNull('scheduled_at'))
            ->orderBy('matching_started_at')
            ->limit(50)
            ->get();

        $resumed = 0;
        foreach ($bookings as $booking) {
            if (BookingService::isScheduled($booking) || ! BookingService::matchingDeadline($booking)->isFuture()) {
                continue;
            }

            try {
                BookingService::beginMatching($booking);
                $resumed++;
            } catch (\Throwable $e) {
                Log::error('Could not resume the search for a paid errand', ['booking_id' => $booking->id, 'error' => $e->getMessage()]);
            }
        }

        if ($resumed > 0) {
            Log::warning("Resumed the search for {$resumed} paid errand(s) whose search never ran");
            $this->warn("Resumed the search for {$resumed} paid errand(s) whose search never ran.");
        }
    }

    /**
     * Detective control: money taken for an errand that never happened.
     *
     * A wallet-funded booking debits the customer and then records the paid flag.
     * Those are now one transaction, but any future drift in that seam — or a
     * refund path that silently declines — ends the same way: a committed
     * `payment` ledger row against a cancelled booking with no `refund` beside
     * it. The wallet reconciler cannot see this: the debit is internally
     * consistent, just orphaned, so balance still equals the ledger.
     *
     * A cancellation fee that consumes the whole charge is legitimate and writes
     * no refund row, so those are excluded rather than reported forever.
     */
    private function flagChargedButNeverRefunded(): void
    {
        // Recent cancellations only. This runs every 15 minutes and used to
        // test every cancelled booking ever made against wallet_transactions,
        // a scan that grows for the life of the platform. An orphan is
        // alerted on from the first sweep after its cancel, so a month of
        // re-alerts is plenty. Every cancel path stamps cancelled_at; a row
        // without one (an older or 'failed' booking) is aged by updated_at.
        $since = now()->subDays(self::ORPHAN_LOOKBACK_DAYS);

        $orphaned = Booking::query()
            ->whereIn('status', ['cancelled', 'failed'])
            ->where(fn ($q) => $q->where('cancelled_at', '>=', $since)
                ->orWhere(fn ($q) => $q->whereNull('cancelled_at')->where('updated_at', '>=', $since)))
            ->whereExists(fn ($q) => $q->selectRaw('1')
                ->from('wallet_transactions')
                ->whereColumn('wallet_transactions.reference_id', 'bookings.id')
                ->where('wallet_transactions.type', 'payment'))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')
                ->from('wallet_transactions')
                ->whereColumn('wallet_transactions.reference_id', 'bookings.id')
                ->where('wallet_transactions.type', 'refund'))
            // A full-value cancellation fee keeps the money by design.
            ->where(function ($q) {
                $q->whereNull('cancellation_fee')
                    ->orWhereColumn('cancellation_fee', '<', 'total_amount');
            })
            ->orderBy('updated_at')
            ->limit(50)
            ->get(['id', 'booking_number', 'status', 'cancellation_fee', 'total_amount']);

        if ($orphaned->isEmpty()) {
            $this->info('No charged-but-unrefunded cancellations.');

            return;
        }

        $numbers = $orphaned->pluck('booking_number')->take(10)->implode(', ');

        $this->error("{$orphaned->count()} cancelled errand(s) charged with no refund: {$numbers}");

        Log::critical('Cancelled errands charged with no refund', [
            'count' => $orphaned->count(),
            'booking_numbers' => $orphaned->pluck('booking_number')->take(10)->all(),
        ]);

        AdminAlert::raise(
            'charged_unrefunded_cancellation',
            'critical',
            'Cancelled errands that were charged and never refunded',
            "{$orphaned->count()} cancelled errand(s) hold a wallet payment with no matching refund: {$numbers}. "
                .'The customer paid for an errand that never happened — refund each manually.',
            $orphaned->first()->id,
        );
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
