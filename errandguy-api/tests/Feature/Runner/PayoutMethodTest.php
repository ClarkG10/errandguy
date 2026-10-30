<?php

namespace Tests\Feature\Runner;

use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A runner's payout method says which channel it is — GCash, Maya or a bank —
 * with the account number and the account holder's name. It used to be
 * guessed from which number happened to be filled in, so staff could send a
 * GCash number down a bank channel. Runners can change or remove it; a payout
 * request records it on the payout, which is what staff send to.
 */
class PayoutMethodTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 1000, 'full_name' => 'Rhea Runner']);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'preferred_types' => [],
            'bank_name' => 'BPI', 'bank_account_number' => '9999999999',
        ]);
    }

    private function save(array $payload)
    {
        return $this->actingAs($this->runner)->putJson('/api/v1/runner/payout-method', $payload);
    }

    private function requestPayout(float $amount = 500)
    {
        return $this->actingAs($this->runner)
            ->withHeader('Idempotency-Key', 'payout-'.bin2hex(random_bytes(6)))
            ->postJson('/api/v1/runner/payout/request', ['amount' => $amount]);
    }

    public function test_saving_gcash_replaces_the_old_method_and_is_used_for_the_next_payout(): void
    {
        $this->save(['channel' => 'gcash', 'account_number' => '09171234567', 'account_name' => 'Rhea R. Runner'])
            ->assertOk()
            ->assertJsonPath('data.payout_channel', 'gcash')
            ->assertJsonPath('data.payout_account_name', 'Rhea R. Runner')
            ->assertJsonPath('data.ewallet_number', '09171234567')
            ->assertJsonPath('data.bank_name', null)
            ->assertJsonPath('message', 'Payout method saved: GCash •••• 4567.');

        $profile = $this->runner->runnerProfile->fresh();
        $this->assertNull($profile->bank_account_number, 'one payout method: the old bank account is cleared');
        $this->assertSame('PH_GCASH', $profile->payout_channel_code);

        $this->requestPayout()->assertOk()->assertJsonPath('message', fn (string $m) => str_contains($m, 'GCash •••• 4567'));

        $tx = WalletTransaction::where('type', 'payout')->firstOrFail();
        $this->assertSame([
            'channel' => 'gcash', 'channel_code' => 'PH_GCASH', 'account_number' => '09171234567',
            'account_name' => 'Rhea R. Runner', 'bank_name' => null,
        ], $tx->payout_destination);
    }

    public function test_saving_a_bank_account_needs_the_bank_and_knows_its_channel(): void
    {
        $this->save(['channel' => 'bank', 'account_number' => '0012-3456-7890', 'account_name' => 'Rhea Runner'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['bank_name']);

        $this->save(['channel' => 'bank', 'account_number' => '0012-3456-7890', 'account_name' => 'Rhea Runner', 'bank_name' => 'BDO'])
            ->assertOk()
            ->assertJsonPath('data.payout_channel', 'bank')
            ->assertJsonPath('data.bank_name', 'BDO')
            ->assertJsonPath('data.bank_account_last4', '7890')
            ->assertJsonPath('data.ewallet_number', null);

        $this->requestPayout()->assertOk();
        $destination = WalletTransaction::where('type', 'payout')->firstOrFail()->payout_destination;
        $this->assertSame('bank', $destination['channel']);
        $this->assertSame('PH_BDO', $destination['channel_code']);
        $this->assertSame('001234567890', $destination['account_number']);
    }

    public function test_a_bad_number_is_refused_clearly(): void
    {
        $this->save(['channel' => 'maya', 'account_number' => '1234', 'account_name' => 'Rhea'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Enter the GCash or Maya mobile number, e.g. 09171234567.');
    }

    public function test_removing_the_method_stops_new_payouts_but_not_ones_already_requested(): void
    {
        $this->save(['channel' => 'gcash', 'account_number' => '09171234567', 'account_name' => 'Rhea'])->assertOk();
        $this->requestPayout(300)->assertOk();

        $this->actingAs($this->runner)->deleteJson('/api/v1/runner/payout-method')
            ->assertOk()
            ->assertJsonPath('data.payout_channel', null)
            ->assertJsonPath('data.ewallet_number', null)
            ->assertJsonPath('data.bank_name', null);

        $this->requestPayout()->assertStatus(422)->assertJsonPath('code', 'PAYOUT_METHOD_REQUIRED');

        // The payout already requested still knows where it is going.
        $this->assertSame('09171234567', WalletTransaction::where('type', 'payout')->firstOrFail()->payout_destination['account_number']);
    }

    public function test_the_app_build_already_on_phones_still_saves_through_the_profile(): void
    {
        $this->save(['channel' => 'maya', 'account_number' => '09281112222', 'account_name' => 'Rhea'])->assertOk();

        // That build never says which e-wallet a number is, so its save goes
        // back to the original rule (e-wallet first; staff pick the channel).
        $this->actingAs($this->runner)->putJson('/api/v1/runner/profile', ['ewallet_number' => '09173334444'])
            ->assertOk()
            ->assertJsonPath('data.payout_channel', null);

        $this->requestPayout()->assertOk();
        $destination = WalletTransaction::where('type', 'payout')->firstOrFail()->payout_destination;
        $this->assertSame('ewallet', $destination['channel']);
        $this->assertNull($destination['channel_code']);
        $this->assertSame('09173334444', $destination['account_number']);
    }
}
