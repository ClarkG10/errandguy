<?php

namespace Tests\Unit;

use App\Models\Booking;
use App\Services\CancellationPolicy;
use PHPUnit\Framework\TestCase;

/**
 * Locks the cancellation-fee tiers (audit H24 — previously untested):
 *   pending/matched      → free
 *   accepted/heading     → flat ₱20
 *   arrived+/in-progress → 50% of total_amount
 *   terminal             → not cancellable
 * Pure computation, so no DB is needed (in-memory Booking models).
 */
class CancellationPolicyTest extends TestCase
{
    private function booking(string $status, float $total = 200.0): Booking
    {
        $b = new Booking();
        $b->status = $status;
        $b->total_amount = $total;

        return $b;
    }

    public function test_pre_match_statuses_are_free_and_cancellable(): void
    {
        foreach (['pending', 'matched'] as $status) {
            $p = CancellationPolicy::preview($this->booking($status));
            $this->assertSame(0.0, $p['fee'], $status);
            $this->assertSame('free', $p['tier'], $status);
            $this->assertTrue($p['cancellable'], $status);
        }
    }

    public function test_accepted_and_heading_charge_the_flat_fee(): void
    {
        foreach (['accepted', 'heading_to_pickup'] as $status) {
            $p = CancellationPolicy::preview($this->booking($status));
            $this->assertSame(CancellationPolicy::ACCEPTED_FLAT_FEE, $p['fee'], $status);
            $this->assertSame('flat', $p['tier'], $status);
            $this->assertTrue($p['cancellable'], $status);
        }
    }

    public function test_arrived_or_in_progress_charges_the_percentage(): void
    {
        // 50% of ₱240 = ₱120.
        foreach (['arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered'] as $status) {
            $p = CancellationPolicy::preview($this->booking($status, 240.0));
            $this->assertSame(120.0, $p['fee'], $status);
            $this->assertSame('percentage', $p['tier'], $status);
            $this->assertTrue($p['cancellable'], $status);
        }
    }

    public function test_terminal_statuses_are_not_cancellable(): void
    {
        foreach (['completed', 'cancelled', 'no_runner'] as $status) {
            $p = CancellationPolicy::preview($this->booking($status));
            $this->assertSame(0.0, $p['fee'], $status);
            $this->assertFalse($p['cancellable'], $status);
        }
    }

    public function test_percentage_fee_rounds_to_two_decimals(): void
    {
        // 50% of ₱115.55 = ₱57.775 → 57.78.
        $p = CancellationPolicy::preview($this->booking('in_transit', 115.55));
        $this->assertSame(57.78, $p['fee']);
    }
}
