<?php

namespace App\Console\Commands;

use App\Models\AdminAlert;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Settle payouts whose gateway webhook never arrived.
 *
 * The money-OUT mirror of errandguy:reconcile-topups, and the worse of the two
 * for the person on the other end: the runner's wallet is debited the moment
 * the payout row is created, and the row stays `pending` until
 * payout.succeeded / payout.failed lands. If that webhook is dropped, their
 * money has left their balance with nothing confirming it — and because the app
 * swaps the CTA to "View payout status" whenever a pending payout exists, they
 * cannot request another. Their only route out was to work out that something
 * was wrong and ask an admin to settle it by hand.
 *
 * The wallet list endpoint already reconciles on read, which covers the runner
 * who checks. This covers the one who doesn't — and the runner who is owed
 * money is exactly the person who eventually will.
 *
 * Settlement runs through WalletService::refreshSentPayout →
 * completePayout / failPayout only, both row-locked and pending-guarded
 * (failPayout is what re-credits the wallet), so this can neither pay twice
 * nor credit twice. Payouts whose send went unanswered are looked up by their
 * reference; one Xendit has no record of is left for staff ("Check with
 * Xendit").
 */
class ReconcilePendingPayoutsCommand extends Command
{
    protected $signature = 'errandguy:reconcile-payouts
        {--min-age=10 : Only consider payouts older than this many minutes (gives the webhook first refusal)}
        {--max-age=30 : Ignore payouts older than this many days}
        {--limit=200 : Max payouts examined per run}
        {--dry-run : Report what would be reconciled without settling anything}';

    protected $description = 'Reconcile pending runner payouts against the payment gateway';

    public function handle(WalletService $wallet): int
    {
        $minAgeMinutes = max(1, (int) $this->option('min-age'));
        $maxAgeDays = max(1, (int) $this->option('max-age'));
        $limit = max(1, (int) $this->option('limit'));
        $dryRun = (bool) $this->option('dry-run');

        // Oldest first — the runner who has been waiting longest for their own
        // money is served first.
        $pending = WalletTransaction::query()
            ->where('type', 'payout')
            ->where('status', 'pending')
            // Sent to Xendit: with its id, or with an unanswered send.
            ->where(fn ($q) => $q->whereNotNull('gateway_ref')->orWhereNotNull('payout_sent_at'))
            ->where('created_at', '<=', now()->subMinutes($minAgeMinutes))
            ->where('created_at', '>=', now()->subDays($maxAgeDays))
            ->orderBy('created_at')
            ->limit($limit)
            ->get();

        if ($pending->isEmpty()) {
            $this->info('No pending payouts to reconcile.');

            return self::SUCCESS;
        }

        $this->info("Examining {$pending->count()} pending payout(s)…");

        $paid = 0;
        $bounced = 0;
        $stillPending = 0;

        foreach ($pending as $tx) {
            if ($dryRun) {
                $this->line("  would pull {$tx->id} (₱{$tx->amount}, ref {$tx->gateway_ref})");

                continue;
            }

            // Throttle bypassed: this sweep exists precisely where nobody is
            // polling, and --limit plus the run cadence bound gateway load.
            $settled = $wallet->reconcilePendingPayout($tx, 0);

            match ($settled->status) {
                'completed' => $paid++,
                'failed', 'reversed', 'cancelled' => $bounced++,
                default => $stillPending++,
            };

            if ($settled->status !== 'pending') {
                // A payout settled here means no webhook arrived. One is a blip;
                // a pattern is a delivery problem worth fixing at the source.
                Log::warning('Payout settled by sweep, not webhook', [
                    'transaction_id' => $tx->id,
                    'user_id' => $tx->user_id,
                    'settled_as' => $settled->status,
                    'stranded_minutes' => (int) $tx->created_at->diffInMinutes(now()),
                ]);

                AdminAlert::raise(
                    'payout_reconciled',
                    'warning',
                    'Payout settled by reconciliation sweep',
                    "A ₱{$tx->amount} payout was resolved as '{$settled->status}' by the gateway but no "
                        .'webhook settled it. Repeated occurrences indicate a webhook-delivery problem.',
                    $tx->id,
                );
            }
        }

        if ($dryRun) {
            $this->info('Dry run — nothing settled.');

            return self::SUCCESS;
        }

        $this->info("Paid: {$paid}  Bounced back to wallet: {$bounced}  Still pending: {$stillPending}");

        return self::SUCCESS;
    }
}
