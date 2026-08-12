<?php

namespace Tests\Unit;

use App\Services\SOSService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * Safety arch-guard (mirrors the WalletService money-safety guard, QA-1).
 *
 * SOSService's alert-lifecycle methods (triggerSOS / deactivateSOS) must take a
 * booking-row lock (lockForUpdate) INSIDE a DB::transaction. Two concurrent panic
 * presses for the same booking — the customer AND the runner, who are different
 * users so the per-user throttle does NOT serialize them — would otherwise each
 * read "no active alert" and each insert one, leaving a duplicate active alert
 * that deactivateSOS then orphans (active in getActiveSOS() while the booking's
 * sos_triggered flag is cleared).
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

    public function test_deactivate_sos_locks_the_booking_in_a_transaction(): void
    {
        $body = $this->methodBody('deactivateSOS');

        $this->assertStringContainsString(
            'DB::transaction',
            $body,
            'SOSService::deactivateSOS must resolve active alerts + clear the flag inside a DB::transaction.',
        );
        $this->assertStringContainsString(
            'lockForUpdate',
            $body,
            'SOSService::deactivateSOS must lockForUpdate the booking row so a concurrent trigger cannot interleave and leave the flag and the alerts inconsistent.',
        );
    }
}
