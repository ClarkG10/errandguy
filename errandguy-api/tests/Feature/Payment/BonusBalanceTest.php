<?php

namespace Tests\Feature\Payment;

use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Payment review P0-6: the non-withdrawable bonus sub-balance.
 *
 * Bonuses are spendable on errands but can never leave the platform as cash:
 * spent before wallet cash, excluded from payout, and refunded back to the
 * bonus bucket (never laundered into withdrawable balance).
 */
class BonusBalanceTest extends TestCase
{
    use RefreshDatabase;

    private function wallet(): WalletService
    {
        return app(WalletService::class);
    }

    public function test_bonus_is_spent_before_withdrawable_cash(): void
    {
        $user = User::factory()->create(['wallet_balance' => 100, 'bonus_balance' => 40]);

        // A ₱50 errand: ₱40 bonus drained first, then ₱10 wallet.
        $tx = $this->wallet()->deduct($user->id, 50, 'booking-1', 'Errand');

        $user->refresh();
        $this->assertEquals(90.0, (float) $user->wallet_balance);
        $this->assertEquals(0.0, (float) $user->bonus_balance);
        $this->assertEquals(40.0, (float) $tx->bonus_portion);
    }

    public function test_bonus_only_balance_cannot_be_paid_out(): void
    {
        // Withdrawable wallet is empty; only non-withdrawable bonus is funded.
        $user = User::factory()->create(['wallet_balance' => 0, 'bonus_balance' => 500]);

        $this->expectException(\RuntimeException::class);
        $this->wallet()->payout($user->id, 200);
    }

    public function test_bonus_can_still_pay_for_an_errand(): void
    {
        $user = User::factory()->create(['wallet_balance' => 0, 'bonus_balance' => 200]);

        $tx = $this->wallet()->deduct($user->id, 150, 'booking-2', 'Errand');

        $user->refresh();
        $this->assertEquals(0.0, (float) $user->wallet_balance);
        $this->assertEquals(50.0, (float) $user->bonus_balance);
        $this->assertEquals(150.0, (float) $tx->bonus_portion);
    }

    public function test_refund_of_a_bonus_funded_booking_returns_to_bonus_not_cash(): void
    {
        // Pays ₱50 for an errand: ₱40 bonus + ₱10 wallet.
        $user = User::factory()->create(['wallet_balance' => 10, 'bonus_balance' => 40]);
        $this->wallet()->deduct($user->id, 50, 'booking-3', 'Errand');

        $user->refresh();
        $this->assertEquals(0.0, (float) $user->wallet_balance);
        $this->assertEquals(0.0, (float) $user->bonus_balance);

        // Full refund: withdrawable gets back only the ₱10 it put in; the ₱40
        // promo share returns to bonus — it can never become cashable.
        $this->wallet()->refund($user->id, 50, 'booking-3');

        $user->refresh();
        $this->assertEquals(10.0, (float) $user->wallet_balance);
        $this->assertEquals(40.0, (float) $user->bonus_balance);
    }

    public function test_refund_of_gateway_funded_booking_goes_fully_to_wallet(): void
    {
        // No wallet payment debit exists for this reference (the booking was
        // paid at the gateway), so a wallet refund is real money owed back and
        // belongs entirely in the withdrawable wallet.
        $user = User::factory()->create(['wallet_balance' => 0, 'bonus_balance' => 0]);

        $this->wallet()->refund($user->id, 115, 'gateway-booking');

        $user->refresh();
        $this->assertEquals(115.0, (float) $user->wallet_balance);
        $this->assertEquals(0.0, (float) $user->bonus_balance);
    }

    public function test_refund_is_idempotent_across_buckets(): void
    {
        $user = User::factory()->create(['wallet_balance' => 10, 'bonus_balance' => 40]);
        $this->wallet()->deduct($user->id, 50, 'booking-4', 'Errand');
        $this->wallet()->refund($user->id, 50, 'booking-4');
        $this->wallet()->refund($user->id, 50, 'booking-4'); // replay

        $user->refresh();
        $this->assertEquals(10.0, (float) $user->wallet_balance);
        $this->assertEquals(40.0, (float) $user->bonus_balance);
        $this->assertSame(1, WalletTransaction::where('user_id', $user->id)
            ->where('type', 'refund')->count());
    }
}
