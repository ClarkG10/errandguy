<?php

namespace Tests\Feature\Payment;

use App\Models\AdminUser;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Money-OUT coverage for the runner payout flow (audit H23 — previously zero
 * tests). Locks: request debits under a lock, the guards (min / balance /
 * method), admin complete, and the failed-payout re-credit (no double refund).
 */
class PayoutFlowTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $this->runner = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'wallet_balance' => 1000.00,
        ]);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved',
            'is_online' => true, 'preferred_types' => [], 'ewallet_number' => '09171234567',
        ]);
    }

    private function actingAsAdmin(): AdminUser
    {
        $admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'admin', 'is_active' => true,
        ]);
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_runner_can_request_payout_which_debits_the_wallet(): void
    {
        $this->actingAs($this->runner)
            ->postJson('/api/v1/runner/payout/request', ['amount' => 500])
            ->assertOk();

        $this->assertEquals(500.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'payout', 'amount' => '-500.00', 'status' => 'pending',
        ]);
    }

    public function test_payout_requires_a_configured_method(): void
    {
        $this->runner->runnerProfile->update(['ewallet_number' => null, 'bank_name' => null]);

        $this->actingAs($this->runner)
            ->postJson('/api/v1/runner/payout/request', ['amount' => 500])
            ->assertStatus(422);

        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_payout_below_minimum_is_rejected_without_debiting(): void
    {
        // min_payout_amount defaults to 100.
        $this->actingAs($this->runner)
            ->postJson('/api/v1/runner/payout/request', ['amount' => 50])
            ->assertStatus(422);

        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertDatabaseMissing('wallet_transactions', ['user_id' => $this->runner->id, 'type' => 'payout']);
    }

    public function test_payout_exceeding_balance_is_rejected_without_debiting(): void
    {
        $this->actingAs($this->runner)
            ->postJson('/api/v1/runner/payout/request', ['amount' => 2000])
            ->assertStatus(422);

        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertDatabaseMissing('wallet_transactions', ['user_id' => $this->runner->id, 'type' => 'payout']);
    }

    public function test_admin_can_mark_a_pending_payout_completed(): void
    {
        $payout = WalletTransaction::create([
            'user_id' => $this->runner->id, 'type' => 'payout', 'amount' => -500,
            'balance_after' => 500, 'description' => 'Payout request', 'status' => 'pending',
        ]);

        $this->actingAsAdmin();
        $this->postJson("/api/v1/admin/payouts/{$payout->id}/complete")->assertOk();

        $this->assertEquals('completed', $payout->fresh()->status);
        // Completing does NOT touch the balance (already debited on request).
        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_marking_a_failed_payout_re_credits_the_wallet(): void
    {
        // Runner requests 500 (1000 -> 500), then the disbursement bounces.
        $this->actingAs($this->runner)
            ->postJson('/api/v1/runner/payout/request', ['amount' => 500])->assertOk();
        $payout = WalletTransaction::where('user_id', $this->runner->id)->where('type', 'payout')->firstOrFail();
        $this->assertEquals(500.0, (float) $this->runner->fresh()->wallet_balance);

        $this->actingAsAdmin();
        $this->postJson("/api/v1/admin/payouts/{$payout->id}/fail", ['reason' => 'bank rejected'])->assertOk();

        // Money is returned in full, with an audit refund row.
        $this->assertEquals('failed', $payout->fresh()->status);
        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'refund', 'reference_id' => $payout->id, 'amount' => '500.00',
        ]);
    }

    public function test_a_failed_payout_cannot_be_failed_again(): void
    {
        $this->actingAs($this->runner)
            ->postJson('/api/v1/runner/payout/request', ['amount' => 500])->assertOk();
        $payout = WalletTransaction::where('user_id', $this->runner->id)->where('type', 'payout')->firstOrFail();

        $this->actingAsAdmin();
        $this->postJson("/api/v1/admin/payouts/{$payout->id}/fail", ['reason' => 'bounce'])->assertOk();
        // Second attempt is rejected — no second re-credit.
        $this->postJson("/api/v1/admin/payouts/{$payout->id}/fail", ['reason' => 'again'])->assertStatus(422);

        $this->assertEquals(1000.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertEquals(
            1,
            WalletTransaction::where('reference_id', $payout->id)->where('type', 'refund')->count(),
        );
    }
}
