<?php

namespace Tests\Feature\Payment;

use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Guards the money-safety hardening added in migration
 * 2026_07_23_000001_add_money_integrity_constraints and the idempotent
 * WalletService operations. SQLite (the test driver) enforces partial UNIQUE
 * indexes, so the DB-level guard is exercised here even though it cannot
 * reproduce true row-lock concurrency.
 */
class MoneyIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private function wallet(): WalletService
    {
        return app(WalletService::class);
    }

    public function test_refund_is_idempotent_per_reference_and_type(): void
    {
        $user = User::factory()->create(['wallet_balance' => 0]);
        $ref = (string) Str::uuid();

        $first = $this->wallet()->refund($user->id, 100.00, $ref);
        // A retried / double-tapped refund for the SAME booking must not
        // credit the wallet twice.
        $second = $this->wallet()->refund($user->id, 100.00, $ref);

        $this->assertSame($first->id, $second->id, 'the second refund must return the original row, not a new credit');
        $this->assertEqualsWithDelta(100.00, (float) $user->fresh()->wallet_balance, 0.001);
        $this->assertSame(1, WalletTransaction::where('reference_id', $ref)->where('type', 'refund')->count());
    }

    public function test_deduct_is_idempotent_per_reference_and_type(): void
    {
        $user = User::factory()->create(['wallet_balance' => 500]);
        $ref = (string) Str::uuid();

        $first = $this->wallet()->deduct($user->id, 120.00, $ref, 'Booking payment');
        $second = $this->wallet()->deduct($user->id, 120.00, $ref, 'Booking payment');

        $this->assertSame($first->id, $second->id, 'a retried charge must not debit the wallet twice');
        $this->assertEqualsWithDelta(380.00, (float) $user->fresh()->wallet_balance, 0.001);
        $this->assertSame(1, WalletTransaction::where('reference_id', $ref)->where('type', 'payment')->count());
    }

    public function test_deduct_still_rejects_insufficient_balance(): void
    {
        $user = User::factory()->create(['wallet_balance' => 50]);

        $this->expectException(\RuntimeException::class);
        $this->wallet()->deduct($user->id, 100.00, (string) Str::uuid());
    }

    public function test_db_constraint_blocks_duplicate_same_user_reference_type(): void
    {
        $user = User::factory()->create(['wallet_balance' => 0]);
        $ref = (string) Str::uuid();

        WalletTransaction::create([
            'user_id' => $user->id, 'type' => 'earning', 'amount' => 100,
            'balance_after' => 100, 'reference_id' => $ref, 'description' => 'Earning',
        ]);

        // A second earning for the SAME (user, booking) is exactly the
        // double-credit the DB guard exists to reject.
        $this->expectException(UniqueConstraintViolationException::class);
        WalletTransaction::create([
            'user_id' => $user->id, 'type' => 'earning', 'amount' => 100,
            'balance_after' => 200, 'reference_id' => $ref, 'description' => 'Earning (dup)',
        ]);
    }

    public function test_db_constraint_allows_same_reference_for_different_users(): void
    {
        // A referral credits BOTH the referrer and the referee a 'bonus' keyed
        // to the same referral id — legitimate, and must NOT be blocked.
        $a = User::factory()->create(['wallet_balance' => 0]);
        $b = User::factory()->create(['wallet_balance' => 0]);
        $ref = (string) Str::uuid();

        $rowA = WalletTransaction::create([
            'user_id' => $a->id, 'type' => 'bonus', 'amount' => 50,
            'balance_after' => 50, 'reference_id' => $ref, 'description' => 'Referrer bonus',
        ]);
        $rowB = WalletTransaction::create([
            'user_id' => $b->id, 'type' => 'bonus', 'amount' => 50,
            'balance_after' => 50, 'reference_id' => $ref, 'description' => 'Referee bonus',
        ]);

        $this->assertNotSame($rowA->id, $rowB->id);
        $this->assertSame(2, WalletTransaction::where('reference_id', $ref)->where('type', 'bonus')->count());
    }

    public function test_db_constraint_allows_distinct_types_for_one_booking(): void
    {
        // One booking legitimately produces a 'payment' (charge) and later a
        // 'refund' (cancellation) — different types, same reference, one user.
        $user = User::factory()->create(['wallet_balance' => 1000]);
        $ref = (string) Str::uuid();

        $this->wallet()->deduct($user->id, 100.00, $ref, 'Booking payment');
        $this->wallet()->refund($user->id, 80.00, $ref);

        $this->assertSame(1, WalletTransaction::where('reference_id', $ref)->where('type', 'payment')->count());
        $this->assertSame(1, WalletTransaction::where('reference_id', $ref)->where('type', 'refund')->count());
        // 1000 - 100 + 80 = 980
        $this->assertEqualsWithDelta(980.00, (float) $user->fresh()->wallet_balance, 0.001);
    }
}
