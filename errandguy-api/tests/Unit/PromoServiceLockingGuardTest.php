<?php

namespace Tests\Unit;

use App\Services\PromoService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * Arch-guard (mirrors the SOS / WalletService lock guards). The per-user promo
 * limit is a check-then-create TOCTOU unless the count + the booking insert are
 * serialized under a per-(user,promo) lock. A single-connection phpunit suite
 * can't reproduce the true race, so this static guard fails CI the moment
 * assertUserSlotAvailable drops its lock on the anchor row.
 */
class PromoServiceLockingGuardTest extends TestCase
{
    public function test_per_user_slot_check_locks_the_anchor_row(): void
    {
        $class = new ReflectionClass(PromoService::class);
        $method = $class->getMethod('assertUserSlotAvailable');
        $lines = file($class->getFileName());
        $body = implode('', array_slice(
            $lines,
            $method->getStartLine() - 1,
            $method->getEndLine() - $method->getStartLine() + 1,
        ));

        $this->assertStringContainsString(
            'lockForUpdate',
            $body,
            'PromoService::assertUserSlotAvailable must lockForUpdate the per-(user,promo) anchor so the count + booking insert serialize — otherwise the per-user limit is a check-then-create TOCTOU.',
        );
        $this->assertStringContainsString(
            'promo_user_redemptions',
            $body,
            'assertUserSlotAvailable must serialize on the promo_user_redemptions anchor row.',
        );
    }
}
