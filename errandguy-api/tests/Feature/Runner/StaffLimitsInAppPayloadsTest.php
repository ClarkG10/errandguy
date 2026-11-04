<?php

namespace Tests\Feature\Runner;

use App\Http\Resources\RunnerProfileResource;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * Two staff settings the app used to hard-code — the cash-debt pause point
 * (₱1,000) and the time a runner has to accept an offer ("about 90 seconds") —
 * now reach it inside payloads it already loads where they are shown: the
 * runner's own profile and GET /wallet/balance. A staff change in the admin
 * panel has to show up there, not leave the app quoting the old number.
 */
class StaffLimitsInAppPayloadsTest extends TestCase
{
    use RefreshDatabase;

    private function runner(float $balance = 0.0): User
    {
        $user = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'wallet_balance' => $balance,
        ]);
        RunnerProfile::create([
            'user_id' => $user->id, 'verification_status' => 'approved', 'preferred_types' => [],
        ]);

        return $user;
    }

    /** @return array<string,mixed> */
    private function profile(User $runner): array
    {
        return $this->actingAs($runner)->getJson('/api/v1/runner/profile')->assertOk()->json('data');
    }

    public function test_runner_profile_falls_back_to_the_server_defaults(): void
    {
        // No rows → the same defaults CashDebtPolicy and the offer expiry use.
        $data = $this->profile($this->runner());

        $this->assertEquals(1000.0, $data['cash_debt_limit']);
        $this->assertSame(90, $data['offer_accept_seconds']);
    }

    public function test_runner_profile_follows_what_staff_set(): void
    {
        $runner = $this->runner();
        SystemConfig::setValue('runner_cash_debt_limit', '1500');
        SystemConfig::setValue('matched_acceptance_timeout_seconds', '120');

        $data = $this->profile($runner);

        $this->assertEquals(1500.0, $data['cash_debt_limit']);
        $this->assertSame(120, $data['offer_accept_seconds']);

        // 0 switches the limit off; the app then names no pause point.
        SystemConfig::setValue('runner_cash_debt_limit', '0');
        $this->assertEquals(0.0, $this->profile($runner)['cash_debt_limit']);
    }

    public function test_the_runner_home_aggregate_profile_carries_them_too(): void
    {
        $runner = $this->runner();
        SystemConfig::setValue('runner_cash_debt_limit', '2500');

        $profile = $this->actingAs($runner)->getJson('/api/v1/runner/home')->assertOk()->json('data.profile');

        $this->assertEquals(2500.0, $profile['cash_debt_limit']);
        $this->assertSame(90, $profile['offer_accept_seconds']);
    }

    public function test_they_are_not_in_a_profile_served_to_someone_else(): void
    {
        $runner = $this->runner();
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $request = Request::create('/api/v1/bookings/x', 'GET');
        $request->setUserResolver(fn () => $customer);

        $data = (new RunnerProfileResource($runner->runnerProfile))->resolve($request);

        $this->assertArrayNotHasKey('cash_debt_limit', $data);
        $this->assertArrayNotHasKey('offer_accept_seconds', $data);
    }

    public function test_wallet_balance_carries_the_cash_debt_limit(): void
    {
        $user = $this->runner(-240.0);

        $this->actingAs($user)->getJson('/api/v1/wallet/balance')
            ->assertOk()
            ->assertJsonPath('data.balance', -240)
            ->assertJsonPath('data.cash_debt_limit', 1000);

        SystemConfig::setValue('runner_cash_debt_limit', '1750.5');

        $this->assertEquals(
            1750.5,
            $this->actingAs($user)->getJson('/api/v1/wallet/balance')->assertOk()->json('data.cash_debt_limit'),
        );
    }

    public function test_staff_only_settings_stay_out_of_the_app_config(): void
    {
        // The two limits are ordinary public settings; this guards that
        // exposing them didn't come with the staff-only ones.
        SystemConfig::setValue('runner_cash_debt_limit', '1000');
        SystemConfig::setValue('ops_alert_emails', 'ops@example.com');

        $config = $this->actingAs($this->runner())->getJson('/api/v1/config/app')->assertOk()->json('data');

        $this->assertArrayHasKey('runner_cash_debt_limit', $config);
        $this->assertArrayNotHasKey('ops_alert_emails', $config);
    }
}
