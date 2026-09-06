<?php

namespace Tests\Feature\Payment;

use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The one way a balance moves.
 *
 * The read→compute→create-row→update-balance ritual used to be copy-pasted
 * across ~15 sites in three files, and had already drifted: the runner earning
 * credited at completion did not round while the one back-filled after a late
 * settlement did, and BOTH wrote an unrounded `balance_after` into the ledger.
 * That matters because the ledger is what `errandguy:reconcile-wallets` treats
 * as the source of truth — a balance_after carrying binary-float noise makes a
 * healthy wallet look divergent (or hides a real divergence).
 *
 * These lock down the two guarantees the primitive exists to provide: the row
 * and the balance are written from ONE rounded figure, and they can never
 * disagree.
 */
class WalletLedgerPrimitiveTest extends TestCase
{
    use RefreshDatabase;

    private function apply(User $user, string $type, float $delta, array $extra = []): WalletTransaction
    {
        // Honour the primitive's contract: inside a transaction, row locked.
        return DB::transaction(function () use ($user, $type, $delta, $extra) {
            $locked = User::whereKey($user->id)->lockForUpdate()->first();

            return app(WalletService::class)->applyLedgerDelta(
                $locked,
                $type,
                $delta,
                null,
                'test movement',
                $extra,
            );
        });
    }

    public function test_the_ledger_row_and_the_balance_never_disagree(): void
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0.10]);

        $tx = $this->apply($user, 'earning', 0.20);

        // 0.1 + 0.2 is the canonical binary-float trap (0.30000000000000004).
        $this->assertSame('0.30', number_format((float) $tx->balance_after, 2));
        $this->assertSame(
            number_format((float) $user->fresh()->wallet_balance, 2),
            number_format((float) $tx->balance_after, 2),
            'the ledger row and the wallet must agree exactly — the reconciler compares them',
        );
    }

    public function test_a_debit_is_recorded_as_a_negative_delta_and_lowers_the_balance(): void
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 100.00]);

        $tx = $this->apply($user, 'commission', -15.50);

        $this->assertEquals(-15.50, (float) $tx->amount);
        $this->assertEquals(84.50, (float) $tx->balance_after);
        $this->assertEquals(84.50, (float) $user->fresh()->wallet_balance);
    }

    public function test_extra_ledger_columns_are_written(): void
    {
        // The payout path depends on this: a payout row MUST land 'pending', or
        // createPayout refuses it after the debit has already committed.
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 500.00]);

        $tx = $this->apply($user, 'payout', -200.00, ['status' => 'pending']);

        $this->assertSame('pending', $tx->status);
        $this->assertEquals(300.00, (float) $user->fresh()->wallet_balance);
    }

    public function test_repeated_movements_keep_the_ledger_exact(): void
    {
        // Accumulated float noise is how a ledger drifts away from its wallet.
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);

        for ($i = 0; $i < 10; $i++) {
            $this->apply($user, 'earning', 0.10);
        }

        $latest = WalletTransaction::where('user_id', $user->id)->latest('id')->first();

        $this->assertEquals(1.00, (float) $user->fresh()->wallet_balance);
        $this->assertEquals(1.00, (float) $latest->balance_after);
    }
}
