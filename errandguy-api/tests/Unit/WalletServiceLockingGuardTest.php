<?php

namespace Tests\Unit;

use App\Services\WalletService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use ReflectionMethod;

/**
 * Money-safety arch-guard (QA-1).
 *
 * Every WalletService method that WRITES a balance (users.wallet_balance /
 * bonus_balance) must first take a row lock (lockForUpdate) inside a
 * DB::transaction, so a concurrent operation on the same wallet can't
 * read-modify-write and silently lose an update (double-credit / lost debit).
 * The whole codebase's money integrity — and this session's reconciler /
 * refund-orphan work — assumes that invariant holds.
 *
 * This is a static guard, not a concurrency test: it inspects each method's
 * source and fails CI the moment a balance-mutating method drops its lock (or a
 * NEW money method is added without one). It is intentionally self-maintaining —
 * there is no hardcoded method list to fall out of date. A true two-connection
 * concurrency test (QA-3) is a separate, heavier follow-up.
 */
class WalletServiceLockingGuardTest extends TestCase
{
    /**
     * @return array<int, array{0:string,1:string}>  [methodName, methodSource]
     */
    private function balanceMutatingMethods(): array
    {
        $class = new ReflectionClass(WalletService::class);
        $lines = file($class->getFileName());

        $out = [];
        foreach ($class->getMethods(ReflectionMethod::IS_PUBLIC | ReflectionMethod::IS_PROTECTED | ReflectionMethod::IS_PRIVATE) as $method) {
            // Only methods declared ON WalletService (skip inherited).
            if ($method->getDeclaringClass()->getName() !== $class->getName()) {
                continue;
            }

            $body = implode('', array_slice(
                $lines,
                $method->getStartLine() - 1,
                $method->getEndLine() - $method->getStartLine() + 1,
            ));

            // A balance WRITE is an update()/create() array key or an
            // increment/decrement on one of the balance columns. Property READS
            // ($user->wallet_balance) and the ledger's balance_after column do
            // not match, so read-only methods are not flagged.
            $writesBalance = preg_match('/[\'"](wallet_balance|bonus_balance)[\'"]\s*=>/', $body) === 1
                || preg_match('/->(increment|decrement)\(\s*[\'"](wallet_balance|bonus_balance)[\'"]/', $body) === 1;

            if ($writesBalance) {
                $out[] = [$method->getName(), $body];
            }
        }

        return $out;
    }

    public function test_the_guard_actually_finds_the_balance_mutating_methods(): void
    {
        // Sanity: if this ever returns nothing, the detection regex has broken
        // and the guard below would pass vacuously.
        $names = array_map(fn ($m) => $m[0], $this->balanceMutatingMethods());

        $this->assertNotEmpty($names, 'The arch-guard found no balance-mutating methods — its detection is broken.');
        // A few known movers must be present.
        foreach (['deduct', 'refund', 'payout', 'adjust'] as $expected) {
            $this->assertContains($expected, $names, "Expected WalletService::{$expected} to be detected as a balance mutator.");
        }
    }

    public function test_every_balance_mutating_method_locks_the_row_in_a_transaction(): void
    {
        foreach ($this->balanceMutatingMethods() as [$name, $body]) {
            $this->assertStringContainsString(
                'lockForUpdate',
                $body,
                "WalletService::{$name} writes a balance but never lockForUpdate()s the row — a concurrent wallet op could read-modify-write and lose an update (money-safety regression).",
            );
            $this->assertStringContainsString(
                'DB::transaction',
                $body,
                "WalletService::{$name} writes a balance outside a DB::transaction — the lock + read-modify-write must be atomic.",
            );
        }
    }
}
