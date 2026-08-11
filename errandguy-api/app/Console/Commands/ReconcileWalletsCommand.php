<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Detective control for wallet-balance integrity (MONEY-6).
 *
 * Every mutation of users.wallet_balance in this codebase (WalletService
 * top-up/payment/tip/adjust/refund/payout, the runner cash-completion
 * earning/commission, RunnerPayoutController, BookingSettlementService) writes a
 * WalletTransaction in the SAME transaction with balance_after set to the
 * resulting balance. So the ledger's newest balance_after for a user MUST equal
 * their stored wallet_balance. This command asserts that invariant and logs a
 * CRITICAL on any divergence.
 *
 * A mismatch means the withdrawable balance moved WITHOUT a matching ledger
 * entry — i.e. an out-of-band write: the parallel NestJS engine on the shared
 * DB, a manual DB edit, or a future code path that forgets the ledger. Catching
 * that early is the whole point: wallet_balance is real, withdrawable money.
 *
 * READ-ONLY: it never mutates money — it only compares and reports, so it is
 * always safe to run. It intentionally does NOT reconcile bonus_balance, which
 * is a separate bucket (a documented follow-up).
 *
 * 'bonus' rows are EXCLUDED from the "latest wallet row" selection: a bonus
 * credit (ReferralService) records balance_after = the new bonus_balance total,
 * NOT wallet_balance, so counting it would flag every freshly-referred user.
 * Every OTHER transaction type records balance_after = wallet_balance, so a
 * denylist (rather than an allowlist) also auto-covers any future wallet type.
 * Any future type that records a NON-wallet balance_after must be added here.
 *
 * "Latest" wallet row = MAX(id) among non-bonus rows: HasUuids issues UUIDs with
 * a millisecond-timestamp prefix, so MAX(id) is the most recent wallet row to
 * that precision. Two wallet rows for ONE user in the same millisecond would be
 * ordered only by the UUID's random tail — but per-user write serialization
 * (lockForUpdate on every balance mutation) makes that spacing unreachable in
 * practice, and a transient miss self-corrects on the next daily run.
 */
class ReconcileWalletsCommand extends Command
{
    /**
     * Transaction types whose balance_after does NOT track wallet_balance and so
     * must be ignored when finding a user's latest wallet-balance snapshot.
     */
    private const NON_WALLET_TYPES = ['bonus'];

    protected $signature = 'errandguy:reconcile-wallets {--tolerance=0.01 : Peso delta tolerated before a wallet is flagged}';

    protected $description = 'Assert every wallet_balance equals its ledger (latest balance_after) and log a CRITICAL on drift (MONEY-6).';

    public function handle(): int
    {
        $tolerance = (float) $this->option('tolerance');
        $checked = 0;
        $mismatches = 0;

        // withTrashed: a soft-deleted account can still take a webhook top-up /
        // refund, so its balance can drift too — reconcile it as well.
        User::withTrashed()
            ->select('id', 'wallet_balance')
            ->chunkById(500, function ($users) use (&$checked, &$mismatches, $tolerance) {
                $ids = $users->pluck('id')->all();

                // Newest WALLET-affecting ledger row per user in this chunk → its
                // balance_after is the expected wallet_balance. 'bonus' rows are
                // excluded (their balance_after is the bonus_balance total). Users
                // with no wallet rows are absent from the map and expected to hold
                // a zero wallet balance.
                $expectedByUser = WalletTransaction::whereIn('id', function ($q) use ($ids) {
                    $q->from('wallet_transactions')
                        ->selectRaw('MAX(id)')
                        ->whereIn('user_id', $ids)
                        ->whereNotIn('type', self::NON_WALLET_TYPES)
                        ->groupBy('user_id');
                })->pluck('balance_after', 'user_id');

                foreach ($users as $user) {
                    $checked++;
                    $expected = isset($expectedByUser[$user->id])
                        ? (float) $expectedByUser[$user->id]
                        : 0.0;
                    $actual = (float) $user->wallet_balance;

                    if (abs($expected - $actual) > $tolerance) {
                        $mismatches++;
                        Log::critical('Wallet reconciliation mismatch — stored balance diverges from the ledger', [
                            'user_id' => $user->id,
                            'ledger_balance_after' => round($expected, 2),
                            'stored_wallet_balance' => round($actual, 2),
                            'delta' => round($actual - $expected, 2),
                        ]);
                    }
                }
            });

        if ($mismatches > 0) {
            Log::critical("Wallet reconciliation: {$mismatches} of {$checked} wallet(s) diverge from the ledger — investigate for out-of-band balance writes.");
        }

        $this->info("Reconciled {$checked} wallet(s); {$mismatches} mismatch(es).");

        // Non-zero exit surfaces a divergence to the scheduler/monitoring on top
        // of the CRITICAL log; a clean run exits 0.
        return $mismatches > 0 ? self::FAILURE : self::SUCCESS;
    }
}
