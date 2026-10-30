<?php

namespace Tests\Unit;

use App\Services\SOSService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * Safety arch-guard (mirrors the WalletService money-safety guard, QA-1).
 *
 * SOSService's alert-lifecycle methods (triggerSOS and every close) must take a
 * booking-row lock (lockForUpdate) INSIDE a DB::transaction. Two concurrent panic
 * presses for the same booking — the customer AND the runner, who are different
 * users so the per-user throttle does NOT serialize them — would otherwise each
 * read "no active alert" and each insert one, leaving a duplicate active alert,
 * or a close could clear the booking's sos_triggered flag while an alert is
 * still open.
 *
 * A single-connection phpunit suite cannot reproduce the true two-transaction
 * race (a real two-connection harness is a heavier, MySQL-only follow-up), so
 * this static guard fails CI the moment either method drops its lock/transaction.
 */
class SosServiceLockingGuardTest extends TestCase
{
    private function methodBody(string $name): string
    {
        $class = new ReflectionClass(SOSService::class);
        $method = $class->getMethod($name);
        $lines = file($class->getFileName());

        return implode('', array_slice(
            $lines,
            $method->getStartLine() - 1,
            $method->getEndLine() - $method->getStartLine() + 1,
        ));
    }

    public function test_trigger_sos_locks_the_booking_in_a_transaction(): void
    {
        $body = $this->methodBody('triggerSOS');

        $this->assertStringContainsString(
            'DB::transaction',
            $body,
            'SOSService::triggerSOS must run its check-then-insert inside a DB::transaction.',
        );
        $this->assertStringContainsString(
            'lockForUpdate',
            $body,
            'SOSService::triggerSOS must lockForUpdate the booking row so two concurrent triggers on the same booking serialize (no duplicate active alert).',
        );
    }

    /**
     * Every method that closes alerts and re-derives booking.sos_triggered
     * must lock the booking row inside a transaction, so a concurrent trigger
     * cannot interleave and leave the flag and the alerts inconsistent.
     */
    public function test_closing_an_sos_locks_the_booking_in_a_transaction(): void
    {
        foreach (['cancelByRaiser', 'resolveByStaff', 'closeStale'] as $method) {
            $body = $this->methodBody($method);

            $this->assertStringContainsString(
                'DB::transaction',
                $body,
                "SOSService::{$method} must close alerts + re-derive the flag inside a DB::transaction.",
            );
            $this->assertStringContainsString(
                'lockForUpdate',
                $body,
                "SOSService::{$method} must lockForUpdate the booking row so a concurrent trigger cannot interleave.",
            );
        }
    }
}
