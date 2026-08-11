<?php

namespace Tests\Feature\Wallet;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Covers the wallet-integrity detective control (errandguy:reconcile-wallets,
 * MONEY-6): every wallet_balance must equal its ledger's latest balance_after,
 * and any out-of-band divergence is flagged. Read-only — asserts detection, not
 * mutation.
 */
class ReconcileWalletsTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(float $walletBalance): User
    {
        return User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => $walletBalance,
        ]);
    }

    private function ledger(User $u, float $balanceAfter, string $type = 'top_up'): WalletTransaction
    {
        // Only balance_after matters to the reconciler; amount is incidental here.
        return WalletTransaction::create([
            'user_id' => $u->id,
            'type' => $type,
            'amount' => $balanceAfter,
            'balance_after' => $balanceAfter,
            'status' => 'completed',
        ]);
    }

    public function test_a_wallet_matching_its_ledger_is_clean(): void
    {
        $u = $this->makeUser(100.00);
        $this->ledger($u, 100.00);

        $this->artisan('errandguy:reconcile-wallets')
            ->expectsOutputToContain('0 mismatch(es)')
            ->assertExitCode(0);
    }

    public function test_a_zero_balance_with_no_ledger_is_clean(): void
    {
        // The common case: a customer who never moved money — 0 balance, 0 rows.
        $this->makeUser(0.00);

        $this->artisan('errandguy:reconcile-wallets')
            ->expectsOutputToContain('0 mismatch(es)')
            ->assertExitCode(0);
    }

    public function test_a_balance_that_diverges_from_the_ledger_is_flagged(): void
    {
        // Ledger says the wallet should hold ₱100, but the stored balance is ₱90
        // — an out-of-band debit that never hit the ledger.
        $u = $this->makeUser(90.00);
        $this->ledger($u, 100.00);

        $this->artisan('errandguy:reconcile-wallets')
            ->expectsOutputToContain('1 mismatch(es)')
            ->assertExitCode(1);
    }

    public function test_a_nonzero_balance_with_no_ledger_backing_is_flagged(): void
    {
        // Money in the wallet with no ledger row at all → expected 0, actual 50.
        $this->makeUser(50.00);

        $this->artisan('errandguy:reconcile-wallets')
            ->expectsOutputToContain('1 mismatch(es)')
            ->assertExitCode(1);
    }

    public function test_compares_against_the_latest_transaction_not_an_earlier_one(): void
    {
        // Balance matches the NEWEST row (₱120), not the earlier ₱100 — proves
        // the reconciler keys on MAX(id) (the time-ordered latest), not the first.
        $u = $this->makeUser(120.00);
        $this->ledger($u, 100.00);
        $this->ledger($u, 120.00);

        $this->artisan('errandguy:reconcile-wallets')
            ->expectsOutputToContain('0 mismatch(es)')
            ->assertExitCode(0);
    }

    public function test_respects_the_tolerance_option(): void
    {
        // A ₱0.50 delta is flagged at the default ₱0.01 tolerance…
        $u = $this->makeUser(100.50);
        $this->ledger($u, 100.00);

        $this->artisan('errandguy:reconcile-wallets')->assertExitCode(1);

        // …but tolerated when the tolerance is widened past it.
        $this->artisan('errandguy:reconcile-wallets', ['--tolerance' => '1.00'])
            ->expectsOutputToContain('0 mismatch(es)')
            ->assertExitCode(0);
    }

    public function test_ignores_bonus_rows_whose_balance_after_is_the_bonus_total(): void
    {
        // A freshly-referred user: wallet_balance 0, and their only ledger row is
        // a 'bonus' credit whose balance_after is the bonus_balance total (₱50),
        // NOT wallet_balance. This must NOT be read as an expected ₱50 wallet
        // balance — otherwise every referred user would be flagged.
        $u = $this->makeUser(0.00);
        $this->ledger($u, 50.00, 'bonus');

        $this->artisan('errandguy:reconcile-wallets')
            ->expectsOutputToContain('0 mismatch(es)')
            ->assertExitCode(0);
    }

    public function test_uses_latest_wallet_row_even_when_a_bonus_row_is_newer(): void
    {
        // wallet_balance ₱100 matches the newest WALLET row; a later 'bonus' row
        // (balance_after ₱150 = bonus total) must be skipped, not treated as the
        // latest wallet snapshot.
        $u = $this->makeUser(100.00);
        $this->ledger($u, 100.00, 'top_up');
        $this->ledger($u, 150.00, 'bonus');

        $this->artisan('errandguy:reconcile-wallets')
            ->expectsOutputToContain('0 mismatch(es)')
            ->assertExitCode(0);
    }
}
