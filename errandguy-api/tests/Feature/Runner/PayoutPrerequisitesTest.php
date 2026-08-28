<?php

namespace Tests\Feature\Runner;

use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Support\ErrorCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The payout screen must be able to see its own prerequisites BEFORE the runner
 * types an amount and taps Request:
 *   - `bank_account_last4` — the account number is encrypted + $hidden, so the
 *     field rendered empty forever and runners re-typed it every visit;
 *   - `payout_minimum` — the app hardcoded ₱100 while the server reads
 *     min_payout_amount from SystemConfig;
 *   - and a bank with no account number is now refused up front (it used to be
 *     accepted, then sat unsendable in the admin queue).
 *
 * Both new fields are OWNER-ONLY: they must never appear in a runner_profile
 * nested inside a payload served to a customer.
 */
class PayoutPrerequisitesTest extends TestCase
{
    use RefreshDatabase;

    private function runner(array $profile = []): User
    {
        $user = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'wallet_balance' => 1000.00,
        ]);
        RunnerProfile::create(array_merge([
            'user_id' => $user->id, 'verification_status' => 'approved', 'preferred_types' => [],
        ], $profile));

        return $user;
    }

    private function requestPayout(User $runner, float $amount)
    {
        return $this->actingAs($runner)
            ->withHeader('Idempotency-Key', 'payout-'.bin2hex(random_bytes(8)))
            ->postJson('/api/v1/runner/payout/request', ['amount' => $amount]);
    }

    public function test_profile_exposes_only_the_last_four_digits_of_the_saved_account(): void
    {
        $runner = $this->runner([
            'bank_name' => 'BPI', 'bank_account_number' => '1234-5678-9012',
        ]);

        $data = $this->actingAs($runner)->getJson('/api/v1/runner/profile')
            ->assertOk()
            ->json('data');

        // Non-digits are stripped before masking, so a formatted account still
        // yields the true last 4.
        $this->assertSame('9012', $data['bank_account_last4']);
        // The full number is NEVER returned, in any shape.
        $this->assertArrayNotHasKey('bank_account_number', $data);
        $this->assertStringNotContainsString('1234', json_encode($data));
    }

    public function test_last_four_is_null_when_no_account_is_on_file(): void
    {
        $runner = $this->runner(['ewallet_number' => '09171234567']);

        $this->actingAs($runner)->getJson('/api/v1/runner/profile')
            ->assertOk()
            ->assertJsonPath('data.bank_account_last4', null)
            ->assertJsonPath('data.ewallet_number', '09171234567');
    }

    public function test_payout_minimum_comes_from_system_config_not_a_hardcoded_hundred(): void
    {
        $runner = $this->runner(['ewallet_number' => '09171234567']);

        // No row seeded → the documented fallback.
        $this->assertEquals(
            100.0,
            $this->actingAs($runner)->getJson('/api/v1/runner/profile')->assertOk()->json('data.payout_minimum'),
        );

        SystemConfig::setValue('min_payout_amount', '250');

        $this->assertEquals(
            250.0,
            $this->actingAs($runner)->getJson('/api/v1/runner/profile')->assertOk()->json('data.payout_minimum'),
        );

        // And the server really enforces that number, so the client gate and
        // the server gate can no longer disagree.
        $this->requestPayout($runner, 200)
            ->assertStatus(422)
            ->assertJsonPath('code', ErrorCode::PAYOUT_MIN_AMOUNT->value);
    }

    public function test_bank_details_and_payout_minimum_are_hidden_from_other_users(): void
    {
        $runner = $this->runner([
            'bank_name' => 'BPI', 'bank_account_number' => '1234567890',
        ]);
        /** @var User $customer */
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        // Serialize the runner's profile inside a request authenticated as
        // somebody else (the shape a customer gets via BookingResource ->
        // runner -> runner_profile) — the $isSelf gate must strip both new
        // fields, and the last-4 closure must not even be evaluated.
        $request = \Illuminate\Http\Request::create('/');
        $request->setUserResolver(fn () => $customer);
        $serialized = (new \App\Http\Resources\RunnerProfileResource($runner->runnerProfile))->toArray($request);

        $this->assertInstanceOf(\Illuminate\Http\Resources\MissingValue::class, $serialized['bank_account_last4']);
        $this->assertInstanceOf(\Illuminate\Http\Resources\MissingValue::class, $serialized['payout_minimum']);
        $this->assertInstanceOf(\Illuminate\Http\Resources\MissingValue::class, $serialized['bank_name']);
    }

    public function test_a_bank_name_without_an_account_number_is_refused_before_any_debit(): void
    {
        // The old gate accepted this (bank_name alone), handed the runner a
        // "arrives in 1–3 business days" receipt, and stranded the payout: the
        // admin bulk-disburse skips rows with no saved account number.
        $runner = $this->runner(['bank_name' => 'BDO']);

        $this->requestPayout($runner, 500)
            ->assertStatus(422)
            ->assertJsonPath('code', ErrorCode::PAYOUT_METHOD_REQUIRED->value);

        $this->assertEquals(1000.0, (float) $runner->fresh()->wallet_balance);
        $this->assertDatabaseMissing('wallet_transactions', ['user_id' => $runner->id, 'type' => 'payout']);
    }

    public function test_a_complete_bank_method_still_passes_the_gate(): void
    {
        $runner = $this->runner([
            'bank_name' => 'BDO', 'bank_account_number' => '1234567890',
        ]);

        $res = $this->requestPayout($runner, 500)->assertOk();

        $this->assertStringContainsString('BDO account', $res->json('message'));
        $this->assertEquals(500.0, (float) $runner->fresh()->wallet_balance);
        $this->assertSame(1, WalletTransaction::where('user_id', $runner->id)->where('type', 'payout')->count());
    }

    public function test_the_receipt_names_the_destination_the_money_actually_goes_to(): void
    {
        // Both saved: the disbursement resolves `ewallet_number ?: bank_...`,
        // so the receipt must say e-wallet, not "your BDO account".
        $runner = $this->runner([
            'bank_name' => 'BDO', 'bank_account_number' => '1234567890', 'ewallet_number' => '09171234567',
        ]);

        $message = (string) $this->requestPayout($runner, 500)->assertOk()->json('message');

        $this->assertStringContainsString('e-wallet', $message);
        $this->assertStringNotContainsString('BDO', $message);
    }
}
