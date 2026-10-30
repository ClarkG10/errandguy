<?php

namespace Tests\Feature\Payment;

use App\Filament\Pages\Payouts;
use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Customers withdraw their wallet balance to GCash or Maya through the same
 * pending-then-staff-sends payout flow runners use: debited now, sent by staff
 * from the Payouts queue, told when it is sent or if it bounces. Only the
 * withdrawable balance can go (never bonus credit), there is no minimum for a
 * customer, and a double-tap can never withdraw twice.
 */
class CustomerWithdrawalTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 300, 'bonus_balance' => 0,
        ]);
    }

    private function withdraw(array $payload, ?string $key = 'withdraw-key-1', ?User $as = null)
    {
        $request = $this->actingAs($as ?? $this->customer);
        if ($key !== null) {
            $request = $request->withHeader('Idempotency-Key', $key);
        }

        return $request->postJson('/api/v1/wallet/withdraw', $payload);
    }

    private function toGcash(float $amount): array
    {
        return ['amount' => $amount, 'channel' => 'gcash', 'account_number' => '09171234567', 'account_name' => 'Cara Customer'];
    }

    public function test_a_customer_withdraws_any_amount_to_gcash(): void
    {
        // ₱5 — far below the runner minimum, which customers don't have.
        $res = $this->withdraw($this->toGcash(5))->assertCreated();

        $res->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.type', 'payout')
            ->assertJsonMissingPath('data.payout_destination')
            ->assertJsonPath('message', 'Withdrawal of ₱5.00 to GCash •••• 4567 requested. It usually arrives within 1–3 business days — we’ll notify you the moment it’s sent.');

        $this->assertEquals(295.0, (float) $this->customer->fresh()->wallet_balance);

        $tx = WalletTransaction::where('user_id', $this->customer->id)->where('type', 'payout')->firstOrFail();
        $this->assertEquals(-5.0, (float) $tx->amount);
        $this->assertSame('withdraw-key-1', $tx->reference_id);
        $this->assertSame([
            'channel' => 'gcash', 'channel_code' => 'PH_GCASH', 'account_number' => '09171234567',
            'account_name' => 'Cara Customer', 'bank_name' => null,
        ], $tx->payout_destination);
        // Staff see where it goes on the queue.
        $this->assertSame('PH_GCASH', Payouts::destinationFor($tx)['channel_code']);
    }

    public function test_maya_numbers_are_accepted_in_plus63_form(): void
    {
        $this->withdraw(['amount' => 20, 'channel' => 'maya', 'account_number' => '+639281112222', 'account_name' => 'Cara'])
            ->assertCreated();

        $tx = WalletTransaction::where('type', 'payout')->firstOrFail();
        $this->assertSame('PH_PAYMAYA', $tx->payout_destination['channel_code']);
        $this->assertSame('09281112222', $tx->payout_destination['account_number']);
    }

    public function test_a_double_tap_withdraws_once(): void
    {
        $this->withdraw($this->toGcash(100), 'same-key')->assertCreated();
        $this->withdraw($this->toGcash(100), 'same-key')->assertCreated();

        $this->assertEquals(200.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame(1, WalletTransaction::where('type', 'payout')->count());
    }

    public function test_the_service_itself_is_idempotent_on_the_reference(): void
    {
        $wallet = app(WalletService::class);
        $destination = \App\Support\PayoutDestination::make('gcash', '09171234567', 'Cara');

        $first = $wallet->createPendingPayout($this->customer->id, 100, 'ref-1', $destination, 0.0, 'Withdrawal request');
        $second = $wallet->createPendingPayout($this->customer->id, 100, 'ref-1', $destination, 0.0, 'Withdrawal request');

        $this->assertSame($first->id, $second->id);
        $this->assertEquals(200.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_withdrawal_without_an_idempotency_key_is_refused(): void
    {
        $this->withdraw($this->toGcash(100), key: null)->assertStatus(428);

        $this->assertEquals(300.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_more_than_the_balance_is_refused_without_debiting(): void
    {
        $this->withdraw($this->toGcash(301))
            ->assertStatus(422)
            ->assertJsonPath('code', 'INSUFFICIENT_WALLET_BALANCE')
            ->assertJsonPath('message', 'You requested ₱301.00 but your available balance is ₱300.00. Lower the amount and try again.');

        $this->assertEquals(300.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame(0, WalletTransaction::count());
    }

    public function test_bonus_credit_can_never_be_withdrawn(): void
    {
        $this->customer->update(['wallet_balance' => 0, 'bonus_balance' => 100]);

        $this->withdraw($this->toGcash(50))->assertStatus(422)->assertJsonPath('code', 'INSUFFICIENT_WALLET_BALANCE');

        $this->assertEquals(100.0, (float) $this->customer->fresh()->bonus_balance);
    }

    public function test_customers_withdraw_to_gcash_or_maya_only(): void
    {
        $this->withdraw(['amount' => 50, 'channel' => 'bank', 'account_number' => '1234567890', 'account_name' => 'Cara', 'bank_name' => 'BDO'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['channel'])
            ->assertJsonPath('message', 'Choose where to send the money: GCash or Maya.');
    }

    public function test_a_bad_mobile_number_is_refused_clearly(): void
    {
        $this->withdraw(['amount' => 50, 'channel' => 'gcash', 'account_number' => '12345', 'account_name' => 'Cara'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Enter the GCash or Maya mobile number, e.g. 09171234567.');
    }

    public function test_runners_use_their_own_payout_request(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 500]);

        $this->withdraw($this->toGcash(50), as: $runner)->assertForbidden();
    }

    public function test_an_account_with_a_runner_profile_keeps_the_runner_minimum(): void
    {
        // A runner switched to customer mode can't dodge the payout minimum.
        RunnerProfile::create(['user_id' => $this->customer->id, 'verification_status' => 'approved', 'preferred_types' => []]);

        $this->withdraw($this->toGcash(50))
            ->assertStatus(422)
            ->assertJsonPath('code', 'PAYOUT_MIN_AMOUNT');

        $this->assertEquals(300.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_the_customer_is_told_when_it_is_sent_and_when_it_bounces(): void
    {
        $this->withdraw($this->toGcash(100), 'w-1')->assertCreated();
        $this->withdraw($this->toGcash(50), 'w-2')->assertCreated();
        [$sent, $bounced] = WalletTransaction::where('type', 'payout')->orderBy('amount')->get()->all();

        $wallet = app(WalletService::class);
        $wallet->completePayout($sent->id);
        $failed = $wallet->failPayout($bounced->id, 'Account name mismatch');
        $wallet->notifyPayoutBounced($failed, 'Account name mismatch');

        $this->assertTrue(Notification::where('user_id', $this->customer->id)->where('title', 'Payout sent')->exists());
        $this->assertTrue(Notification::where('user_id', $this->customer->id)->where('title', 'Payout couldn’t be sent')->exists());
        $this->assertEquals(200.0, (float) $this->customer->fresh()->wallet_balance, 'the bounced ₱50 is back');
    }
}
