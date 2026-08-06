<?php

namespace Tests\Feature\Payment;

use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Admin manual wallet adjustments: money-safe credit/debit to a user's
 * withdrawable balance, bounded + overdraw-guarded + audited.
 */
class WalletAdjustTest extends TestCase
{
    use RefreshDatabase;

    private WalletService $wallet;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->wallet = app(WalletService::class);
        $this->user = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 100,
        ]);
    }

    public function test_a_credit_adjustment_raises_the_balance_and_records_a_signed_row(): void
    {
        $tx = $this->wallet->adjust($this->user->id, 250, 'Goodwill credit');

        $this->assertSame(350.0, (float) $this->user->fresh()->wallet_balance);
        $this->assertSame('adjustment', $tx->type);
        $this->assertSame(250.0, (float) $tx->amount);
        $this->assertSame(350.0, (float) $tx->balance_after);
        $this->assertStringContainsString('Goodwill credit', $tx->description);
    }

    public function test_a_debit_adjustment_lowers_the_balance(): void
    {
        $tx = $this->wallet->adjust($this->user->id, -40, 'Reversing an erroneous credit');

        $this->assertSame(60.0, (float) $this->user->fresh()->wallet_balance);
        $this->assertSame(-40.0, (float) $tx->amount);
    }

    public function test_a_debit_cannot_overdraw_the_wallet(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->wallet->adjust($this->user->id, -150, 'Too much');
    }

    public function test_overdraw_attempt_leaves_the_balance_untouched(): void
    {
        try {
            $this->wallet->adjust($this->user->id, -150, 'Too much');
        } catch (\RuntimeException) {
            // expected
        }
        $this->assertSame(100.0, (float) $this->user->fresh()->wallet_balance);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->user->id, 'type' => 'adjustment',
        ]);
    }

    public function test_amount_over_the_cap_is_rejected(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->wallet->adjust($this->user->id, WalletService::MAX_ADJUSTMENT + 1, 'Too big');
    }

    public function test_zero_amount_is_rejected(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->wallet->adjust($this->user->id, 0, 'Nothing');
    }

    public function test_a_blank_reason_is_rejected(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->wallet->adjust($this->user->id, 50, '   ');
    }

    public function test_the_same_admin_can_adjust_the_same_user_more_than_once(): void
    {
        // reference_id is NULL, so repeated adjustments never collide on the
        // (user, reference, type) idempotency index.
        $this->wallet->adjust($this->user->id, 50, 'First');
        $this->wallet->adjust($this->user->id, 25, 'Second');

        $this->assertSame(175.0, (float) $this->user->fresh()->wallet_balance);
        $this->assertSame(2, WalletTransaction::where('user_id', $this->user->id)
            ->where('type', 'adjustment')->count());
    }
}
