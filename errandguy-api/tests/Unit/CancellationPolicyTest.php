<?php

namespace Tests\Unit;

use App\Models\Booking;
use App\Services\CancellationPolicy;
use PHPUnit\Framework\TestCase;

/**
 * Locks the cancellation-fee tiers (audit H24 — previously untested):
 *   pending/matched      → free
 *   accepted/heading     → flat ₱20
 *   arrived+/in-progress → not cancellable in the app (BookingPolicy::cancel
 *                          never allowed it, so the old 50% tier was
 *                          unreachable and is gone)
 *   terminal             → not cancellable
 * Pure computation, so no DB is needed (in-memory Booking models).
 */
class CancellationPolicyTest extends TestCase
{
    private function booking(string $status, float $total = 200.0, string $paymentStatus = 'paid'): Booking
    {
        $b = new Booking();
        $b->status = $status;
        $b->total_amount = $total;
        // The fee preview mirrors settlement, which only keeps a fee when money
        // was collected up front; default the fixtures to a paid booking so the
        // tier assertions below exercise the fee-charging path.
        $b->payment_status = $paymentStatus;

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

    public function test_arrived_or_in_progress_is_not_cancellable_and_never_quotes_a_percentage_fee(): void
    {
        foreach (['arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered'] as $status) {
            $p = CancellationPolicy::preview($this->booking($status, 240.0));
            $this->assertSame(0.0, $p['fee'], $status);
            $this->assertSame('free', $p['tier'], $status);
            $this->assertFalse($p['cancellable'], $status);
            $this->assertStringNotContainsString('%', $p['reason'], $status);
        }
    }

    public function test_the_policy_window_matches_who_may_cancel(): void
    {
        // BookingPolicy::cancel is the gate; the fee preview must agree with it
        // on every status, or the app is quoted a fee for a cancel it can't make.
        $policy = new \App\Policies\BookingPolicy();
        $customer = new \App\Models\User();
        $customer->id = 'customer-1';

        foreach (\App\Enums\BookingStatus::values() as $status) {
            $booking = $this->booking($status);
            $booking->customer_id = 'customer-1';

            $this->assertSame(
                $policy->cancel($customer, $booking),
                CancellationPolicy::preview($booking)['cancellable'],
                $status,
            );
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

    public function test_flat_fee_is_capped_at_a_cheap_fare(): void
    {
        // PRICE-4: a ₱20 flat fee can never exceed the fare — a ₱15 errand caps
        // the fee to ₱15 so preview matches settlement (which floors the refund
        // at 0). Previously preview promised ₱20 while settlement kept only ₱15.
        $p = CancellationPolicy::preview($this->booking('accepted', 15.0));
        $this->assertSame(15.0, $p['fee']);
        $this->assertSame('flat', $p['tier']);
        $this->assertTrue($p['cancellable']);
    }

    public function test_cash_booking_has_no_cancellation_fee_at_any_tier(): void
    {
        // PRICE-3: nothing is collected up front on a cash booking, so there is
        // no fee to charge — preview must not promise one that settlement won't
        // (and can't) collect.
        foreach (['accepted', 'heading_to_pickup'] as $status) {
            $p = CancellationPolicy::preview($this->booking($status, 200.0, 'unpaid'));
            $this->assertSame(0.0, $p['fee'], $status);
            $this->assertSame('free', $p['tier'], $status);
            $this->assertTrue($p['cancellable'], $status);
        }
    }
}
