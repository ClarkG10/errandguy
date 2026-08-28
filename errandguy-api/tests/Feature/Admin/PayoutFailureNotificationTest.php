<?php

namespace Tests\Feature\Admin;

use App\Filament\Pages\Payouts;
use App\Models\AdminUser;
use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * A bounced payout must be as loud as a successful one.
 *
 * completePayout() pushes "Payout sent"; "Mark failed" only re-credited the
 * wallet and wrote failure_reason, so the runner kept believing a transfer was
 * in flight for 1–3 business days and then found their balance mysteriously
 * higher — the reason discoverable only by scrolling the payout history card.
 * (SendPushJob runs on the sync queue under test, so the in-app row it writes
 * is the observable proof the notification fired.)
 */
class PayoutFailureNotificationTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->runner = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'wallet_balance' => 500.00,
        ]);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved',
            'preferred_types' => [], 'ewallet_number' => '09171234567',
        ]);

        // Payout complete/fail is a MONEY action — finance/super_admin only.
        $this->actingAs(AdminUser::create([
            'email' => 'finance@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Finance', 'role' => 'finance', 'is_active' => true,
        ]), 'admin');
    }

    private function pendingPayout(float $amount = 500): WalletTransaction
    {
        return WalletTransaction::create([
            'user_id' => $this->runner->id, 'type' => 'payout', 'amount' => -$amount,
            'balance_after' => 0, 'description' => 'Payout request', 'status' => 'pending',
        ]);
    }

    public function test_marking_a_payout_failed_tells_the_runner_where_the_money_went(): void
    {
        $payout = $this->pendingPayout();

        Livewire::test(Payouts::class)
            ->callTableAction('fail', $payout, ['reason' => 'Account name mismatch'])
            ->assertHasNoTableActionErrors();

        $this->assertSame('failed', $payout->fresh()->status);

        $notification = Notification::where('user_id', $this->runner->id)->firstOrFail();

        $this->assertSame('Payout couldn’t be sent', $notification->title);
        // The three things the runner needs: the amount, that the money is
        // BACK, and why.
        $this->assertStringContainsString('500.00', $notification->body);
        $this->assertStringContainsString('back in your wallet', $notification->body);
        $this->assertStringContainsString('Account name mismatch', $notification->body);
        // Payload mirrors the success push so the app routes it identically.
        $this->assertSame('payment', $notification->data['type']);
        $this->assertSame('failed', $notification->data['status']);
        $this->assertSame($payout->id, $notification->data['wallet_transaction_id']);
    }

    public function test_the_runner_is_never_told_twice_about_the_same_bounced_payout(): void
    {
        $payout = $this->pendingPayout();

        Livewire::test(Payouts::class)
            ->callTableAction('fail', $payout, ['reason' => 'bank rejected']);

        // A second run cannot re-fail the payout (failPayout is pending-only),
        // and the cache latch means even a direct re-notify is a no-op — so the
        // runner never gets a duplicate "your payout bounced".
        Payouts::notifyRunnerOfBouncedPayout($payout->fresh(), 'bank rejected');

        $this->assertSame(1, Notification::where('user_id', $this->runner->id)->count());
    }

    public function test_a_reversed_payout_is_announced_as_returned_not_as_failed(): void
    {
        // The webhook-driven `payout.reversed` state (a payout that had already
        // been marked completed and then bounced back from the gateway).
        $payout = $this->pendingPayout(320);
        $payout->update(['status' => 'reversed', 'failure_reason' => 'Beneficiary account closed']);

        Payouts::notifyRunnerOfBouncedPayout($payout->fresh(), null);

        $notification = Notification::where('user_id', $this->runner->id)->firstOrFail();

        $this->assertSame('Payout returned', $notification->title);
        $this->assertStringContainsString('was returned', $notification->body);
        // Falls back to the persisted failure_reason when no reason is passed.
        $this->assertStringContainsString('Beneficiary account closed', $notification->body);
        $this->assertSame('reversed', $notification->data['status']);
    }
}
