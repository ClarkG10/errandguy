<?php

namespace Tests\Feature\Auth;

use App\Filament\Pages\Payouts;
use App\Models\PaymentMethod;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Deleting an account with money in the wallet: the full withdrawable balance
 * is queued as a payout in the same locked step that erases the account, to
 * the destination the request names (or a runner's saved payout method). The
 * destination is recorded on the payout itself, because the account's own
 * details are erased. Bonus credit never blocks deletion.
 */
class AccountDeletionPayoutTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_customer_with_a_balance_is_paid_out_and_erased(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 250.50, 'full_name' => 'Cara Customer']);

        $this->actingAs($user)->deleteJson('/api/v1/user/account', [
            'channel' => 'gcash', 'account_number' => '09171234567', 'account_name' => 'Cara Customer',
        ])
            ->assertOk()
            ->assertJsonPath('data.payout.amount', 250.5)
            ->assertJsonPath('data.payout.status', 'pending')
            ->assertJsonPath('data.payout.destination', 'GCash •••• 4567')
            ->assertJsonPath('message', 'Account deleted. ₱250.50 is on its way to GCash •••• 4567 — it usually arrives within 1–3 business days.');

        $deleted = User::withTrashed()->find($user->id);
        $this->assertNotNull($deleted->deleted_at);
        $this->assertSame('Deleted User', $deleted->full_name);
        $this->assertEquals(0.0, (float) $deleted->wallet_balance);

        $payout = WalletTransaction::where('user_id', $user->id)->where('type', 'payout')->firstOrFail();
        $this->assertEquals(-250.5, (float) $payout->amount);
        $this->assertSame('pending', $payout->status);
        $this->assertSame('Withdrawal on account deletion', $payout->description);
        // Staff can still send it: the destination lives on the payout.
        $this->assertSame('PH_GCASH', Payouts::destinationFor($payout->fresh())['channel_code']);
        $this->assertSame('09171234567', Payouts::destinationFor($payout->fresh())['account_number']);
    }

    public function test_a_runner_with_a_saved_method_does_not_have_to_repeat_it(): void
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 900, 'full_name' => 'Rhea Runner']);
        RunnerProfile::create([
            'user_id' => $user->id, 'verification_status' => 'approved', 'preferred_types' => [],
            'payout_channel' => 'bank', 'bank_name' => 'BDO', 'bank_account_number' => '001234567890',
            'payout_account_name' => 'Rhea Runner',
        ]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertOk();

        $payout = WalletTransaction::where('user_id', $user->id)->where('type', 'payout')->firstOrFail();
        $this->assertEquals(-900.0, (float) $payout->amount);
        $this->assertSame('PH_BDO', $payout->payout_destination['channel_code']);
        $this->assertSame('001234567890', $payout->payout_destination['account_number']);
        // ...although the profile's copy is erased.
        $this->assertNull($user->runnerProfile->fresh()->bank_account_number);
    }

    public function test_a_payout_requested_earlier_keeps_its_destination_after_the_profile_is_erased(): void
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);
        RunnerProfile::create([
            'user_id' => $user->id, 'verification_status' => 'approved', 'preferred_types' => [],
            'ewallet_number' => '09171234567',
        ]);
        // Requested before payouts recorded their destination.
        $older = WalletTransaction::create([
            'user_id' => $user->id, 'type' => 'payout', 'amount' => -400, 'balance_after' => 0,
            'status' => 'pending', 'description' => 'Payout request',
        ]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertOk();

        $this->assertSame('09171234567', $older->fresh()->payout_destination['account_number']);
        $this->assertSame('09171234567', Payouts::destinationFor($older->fresh())['account_number']);
    }

    public function test_bonus_credit_never_blocks_deletion(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0, 'bonus_balance' => 75]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertOk();

        $this->assertNotNull(User::withTrashed()->find($user->id)->deleted_at);
        $this->assertSame(0, WalletTransaction::where('type', 'payout')->count());
    }

    public function test_a_bad_destination_is_refused_and_nothing_is_erased(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 100]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account', [
            'channel' => 'gcash', 'account_number' => '555', 'account_name' => 'Cara',
        ])->assertStatus(422)->assertJsonValidationErrors(['account_number']);

        // Customers are paid out to GCash or Maya only.
        $this->actingAs($user)->deleteJson('/api/v1/user/account', [
            'channel' => 'bank', 'account_number' => '001234567890', 'account_name' => 'Cara', 'bank_name' => 'BDO',
        ])->assertStatus(422)->assertJsonValidationErrors(['channel']);

        $this->assertNull(User::withTrashed()->find($user->id)->deleted_at);
        $this->assertEquals(100.0, (float) $user->fresh()->wallet_balance);
    }

    public function test_a_retired_linked_account_is_erased_with_the_account(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $linked = PaymentMethod::create([
            'user_id' => $user->id, 'type' => 'gcash', 'status' => 'active', 'label' => 'GCash', 'gateway_ref' => 'pm-1',
        ]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertOk();

        $this->assertDatabaseMissing('payment_methods', ['id' => $linked->id]);
    }

    public function test_the_public_delete_account_page_explains_both_routes(): void
    {
        config(['app.support_email' => 'help@errandguy.test']);

        $this->get('/delete-account')
            ->assertOk()
            ->assertSee('Delete your ErrandGuy account')
            ->assertSee('Profile')
            ->assertSee('Delete account')
            ->assertSee('mailto:help@errandguy.test', false)
            ->assertSee('What is deleted')
            ->assertSee('What is kept');
    }
}
