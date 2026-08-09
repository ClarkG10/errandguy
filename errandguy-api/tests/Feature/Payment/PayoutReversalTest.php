<?php

namespace Tests\Feature\Payment;

use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * MONEYX-1 regression: a payout that already SUCCEEDED and then bounces back
 * (Xendit `payout.reversed` / a late failure) must re-credit the runner. The
 * old handler bailed on any non-pending payout, so a post-success reversal was
 * silently dropped — permanently debiting the runner for money that never
 * reached them.
 */
class PayoutReversalTest extends TestCase
{
    use RefreshDatabase;

    private string $webhookToken = 'xnd_test_callback_token_for_testing';
    private User $runner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        config(['services.xendit.webhook_token' => $this->webhookToken]);

        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 500.00]);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true, 'preferred_types' => [],
        ]);
    }

    private function completedPayout(): WalletTransaction
    {
        // 1000 → 500 on request, then disbursed (marked completed).
        return WalletTransaction::create([
            'user_id' => $this->runner->id, 'type' => 'payout', 'amount' => -500,
            'balance_after' => 500, 'description' => 'Payout', 'status' => 'completed',
            'gateway_ref' => 'pyt_reverse_1', 'processed_at' => now(),
        ]);
    }

    public function test_reverse_payout_recredits_the_runner_and_marks_reversed(): void
    {
        $payout = $this->completedPayout();

        app(WalletService::class)->reversePayout($payout->id, 'RECIPIENT_ACCOUNT_CLOSED');

        $this->assertEquals('reversed', $payout->fresh()->status);
        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'refund', 'reference_id' => $payout->id, 'amount' => '500.00',
        ]);
    }

    public function test_reverse_payout_is_idempotent(): void
    {
        $payout = $this->completedPayout();

        app(WalletService::class)->reversePayout($payout->id, 'x');
        app(WalletService::class)->reversePayout($payout->id, 'x');

        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(1, WalletTransaction::where('reference_id', $payout->id)->where('type', 'refund')->count());
    }

    public function test_reverse_payout_refuses_a_pending_payout(): void
    {
        $pending = WalletTransaction::create([
            'user_id' => $this->runner->id, 'type' => 'payout', 'amount' => -500,
            'balance_after' => 500, 'description' => 'Payout', 'status' => 'pending',
        ]);

        $this->expectException(\App\Exceptions\PayoutStateException::class);
        app(WalletService::class)->reversePayout($pending->id, 'x');
    }

    public function test_payout_reversed_webhook_recredits_a_completed_payout(): void
    {
        $payout = $this->completedPayout();

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payout.reversed',
            'data' => ['id' => 'pyt_reverse_1', 'reference_id' => 'payout-'.$payout->id, 'status' => 'REVERSED', 'failure_code' => 'REVERSED'],
        ], ['x-callback-token' => $this->webhookToken])->assertOk();

        $this->assertEquals('reversed', $payout->fresh()->status);
        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
    }
}
