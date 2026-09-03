<?php

namespace App\Console\Commands;

use App\Models\AdminAlert;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Settle top-ups the customer paid for and then walked away from.
 *
 * The status endpoint already pull-reconciles a pending top-up against the
 * gateway — but ONLY while the app is polling it. That leaves the case nothing
 * covered: the customer completes payment in GCash, the webhook is delayed or
 * dropped, and they never reopen the app (or it crashed, or they force-quit
 * from the GCash return). Their money has left their e-wallet, the row stays
 * `pending` forever, and neither side is reconciling. The user's only visible
 * option is to top up a second time.
 *
 * This is the safety net. It reuses WalletService::reconcilePendingTopUp, so
 * there is exactly ONE settlement path shared with the polling endpoint —
 * row-locked, idempotent, and only ever moving a row to the state the gateway
 * itself reports. It cannot credit twice and it cannot invent a payment.
 *
 * A top-up settled here means a webhook did not arrive, which is an OPS signal
 * as much as a user-facing fix — so a late success raises an admin alert.
 */
class ReconcilePendingTopUpsCommand extends Command
{
    protected $signature = 'errandguy:reconcile-topups
        {--min-age=5 : Only consider top-ups older than this many minutes (gives the webhook first refusal)}
        {--max-age=7 : Ignore top-ups older than this many days (long past any gateway payment window)}
        {--limit=200 : Max transactions examined per run (bounds gateway calls per sweep)}
        {--dry-run : Report what would be reconciled without settling anything}';

    protected $description = 'Reconcile pending wallet top-ups against the payment gateway';

    public function handle(WalletService $wallet): int
    {
        $minAgeMinutes = max(1, (int) $this->option('min-age'));
        $maxAgeDays = max(1, (int) $this->option('max-age'));
        $limit = max(1, (int) $this->option('limit'));
        $dryRun = (bool) $this->option('dry-run');

        // Oldest first: a top-up that has been stranded longest is the one whose
        // owner has been waiting longest (and is closest to the gateway's own
        // expiry, after which the truth stops being retrievable).
        $pending = WalletTransaction::query()
            ->where('type', 'top_up')
            ->where('status', 'pending')
            ->whereNotNull('gateway_ref')
            ->where('created_at', '<=', now()->subMinutes($minAgeMinutes))
            ->where('created_at', '>=', now()->subDays($maxAgeDays))
            ->orderBy('created_at')
            ->limit($limit)
            ->get();

        if ($pending->isEmpty()) {
            $this->info('No pending top-ups to reconcile.');

            return self::SUCCESS;
        }

        $this->info("Examining {$pending->count()} pending top-up(s)…");

        $credited = 0;
        $failed = 0;
        $stillPending = 0;

        foreach ($pending as $tx) {
            if ($dryRun) {
                $this->line("  would pull {$tx->id} (₱{$tx->amount}, ref {$tx->gateway_ref})");

                continue;
            }

            // Pass a throttle window of 0 so the sweep is never silenced by the
            // polling endpoint's 10s latch — a stranded top-up is precisely the
            // case where nobody is polling, and the sweep's own cadence (plus
            // --limit) is what bounds gateway load here.
            $settled = $wallet->reconcilePendingTopUp($tx, 0);

            match ($settled->status) {
                'completed' => $credited++,
                'failed', 'expired', 'cancelled' => $failed++,
                default => $stillPending++,
            };

            if ($settled->status === 'completed') {
                // The webhook should have done this. Surface it: one is a blip,
                // a pattern is a webhook-delivery problem worth investigating.
                Log::warning('Top-up settled by sweep, not webhook', [
                    'transaction_id' => $tx->id,
                    'user_id' => $tx->user_id,
                    'stranded_minutes' => (int) $tx->created_at->diffInMinutes(now()),
                ]);

                AdminAlert::raise(
                    'topup_reconciled',
                    'warning',
                    'Top-up credited by reconciliation sweep',
                    "A ₱{$tx->amount} top-up was confirmed paid at the gateway but no webhook settled it. "
                        .'The wallet has been credited. Repeated occurrences indicate a webhook-delivery problem.',
                    $tx->id,
                );
            }
        }

        if ($dryRun) {
            $this->info('Dry run — nothing settled.');

            return self::SUCCESS;
        }

        $this->info("Credited: {$credited}  Closed as failed/expired: {$failed}  Still pending: {$stillPending}");

        return self::SUCCESS;
    }
}
