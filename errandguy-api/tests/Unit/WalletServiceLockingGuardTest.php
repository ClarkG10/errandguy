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
     * The ONE documented exception: applyLedgerDelta is the shared primitive
     * every balance movement funnels through, and its contract explicitly puts
     * the lock on the CALLER (some already hold a booking lock, some guard on a
     * unique reference). It cannot lock itself without either double-locking or
     * silently re-reading a row the caller already holds.
     *
     * Exempting it would punch a hole in this guard — any future method could
     * evade the lock rule by delegating here — so the invariant does not
     * disappear, it MOVES: test_every_caller_of_the_ledger_primitive_locks()
     * below enforces it at the new boundary.
     */
    private const CALLER_LOCKED_PRIMITIVE = 'applyLedgerDelta';

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
            if ($name === self::CALLER_LOCKED_PRIMITIVE) {
                continue; // see the constant's docblock — enforced on callers below
            }

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

    /**
     * The other half of the guard above.
     *
     * applyLedgerDelta reads the balance off the model it is handed, so an
     * unlocked caller is a lost update — the exact double-credit / lost-debit
     * this whole guard exists to prevent. Every call site must therefore hold a
     * lockForUpdate on that row, taken shortly before the call.
     *
     * Checks the 60 lines preceding each call: in practice the lock is always
     * inside the same transaction closure, a few lines up. A new call site
     * dropped into unlocked code fails here.
     */
    public function test_every_caller_of_the_ledger_primitive_locks(): void
    {
        $appDir = dirname(dirname((new ReflectionClass(WalletService::class))->getFileName()));

        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($appDir));
        $callSites = 0;

        foreach ($files as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $lines = file($file->getPathname());
            foreach ($lines as $i => $line) {
                if (! str_contains($line, self::CALLER_LOCKED_PRIMITIVE.'(')) {
                    continue;
                }
                // The declaration itself, not a call.
                if (str_contains($line, 'function '.self::CALLER_LOCKED_PRIMITIVE)) {
                    continue;
                }

                $callSites++;
                $window = implode('', array_slice($lines, max(0, $i - 60), min(60, $i)));

                $this->assertStringContainsString(
                    'lockForUpdate',
                    $window,
                    sprintf(
                        '%s:%d calls %s() without holding a row lock — the balance is read off the passed model, so an unlocked caller loses concurrent updates.',
                        str_replace($appDir, 'app', $file->getPathname()),
                        $i + 1,
                        self::CALLER_LOCKED_PRIMITIVE,
                    ),
                );
            }
        }

        $this->assertGreaterThan(
            0,
            $callSites,
            'Found no call sites of the ledger primitive — this guard would pass vacuously.',
        );
    }
}
