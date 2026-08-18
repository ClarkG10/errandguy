<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Recovery / verify COMPLETION paths (verify-otp, reset-password) use the
 * credential+IP 'auth-verify' limiter, NOT the credential-only 'auth' limiter,
 * so an attacker spamming a victim's phone/email cannot lock the legitimate
 * user out of completing recovery from their own device (AUTHX-3 class). And
 * send-otp carries a per-IP aggregate cap so one source cannot fan out real
 * verification emails to unlimited distinct recipients.
 */
class AuthVerifyThrottleTest extends TestCase
{
    use RefreshDatabase;

    public function test_attacker_cannot_lock_a_victim_out_of_otp_verification_from_another_ip(): void
    {
        $phone = '+639171234567';

        // Attacker at one IP burns the 5/15min credential+IP bucket for the
        // victim's phone with junk verify attempts.
        $this->withServerVariables(['REMOTE_ADDR' => '9.9.9.9']);
        for ($i = 0; $i < 6; $i++) {
            $this->postJson('/api/v1/auth/verify-otp', ['phone' => $phone, 'code' => '000000']);
        }

        // The real user, on their OWN IP, is NOT throttled. Under the old
        // credential-only 'auth' limiter this returned 429; under 'auth-verify'
        // the counter is scoped to the attacker's IP, so the legitimate device
        // is untouched (the request still fails verification — just not 429).
        $this->withServerVariables(['REMOTE_ADDR' => '1.2.3.4']);
        $status = $this->postJson('/api/v1/auth/verify-otp', ['phone' => $phone, 'code' => '000000'])->status();
        $this->assertNotSame(429, $status);
    }

    public function test_single_ip_otp_verification_is_still_capped(): void
    {
        // The credential+IP swap must NOT weaken single-source limits.
        $this->withServerVariables(['REMOTE_ADDR' => '5.5.5.5']);
        $statuses = [];
        for ($i = 0; $i < 6; $i++) {
            $statuses[] = $this->postJson('/api/v1/auth/verify-otp', ['phone' => '+639170000000', 'code' => '000000'])->status();
        }
        $this->assertContains(429, $statuses, 'a single IP must still be capped at 5 verify attempts / 15 min');
    }

    public function test_reset_password_is_on_the_same_credential_plus_ip_limiter(): void
    {
        // Same-IP cap proves reset-password shares 'auth-verify' (regression-
        // guards the route wiring, not just the limiter definition).
        $this->withServerVariables(['REMOTE_ADDR' => '7.7.7.7']);
        $statuses = [];
        for ($i = 0; $i < 6; $i++) {
            $statuses[] = $this->postJson('/api/v1/auth/reset-password', [
                'email' => 'victim@example.com',
                'token' => 'bad-token',
                'password' => 'NewPass123!',
                'password_confirmation' => 'NewPass123!',
            ])->status();
        }
        $this->assertContains(429, $statuses, 'reset-password must be capped per credential+IP');
    }

    public function test_send_otp_has_a_per_ip_aggregate_cap_across_distinct_recipients(): void
    {
        // One source rotating through DISTINCT recipient emails must be capped by
        // the per-IP otp bucket (30/hr). We authenticate the caller so the anon
        // 'api' limiter (20/min) does not confound — an authenticated caller gets
        // 240/min there — leaving the per-IP otp cap as the only limit that can
        // fire. Each recipient is unique, so the per-recipient 3/hr bucket never
        // does. Without the per-IP cap, all 32 would return 200.
        $user = User::factory()->create(['status' => 'active']);

        $this->withServerVariables(['REMOTE_ADDR' => '8.8.8.8']);
        $statuses = [];
        for ($i = 0; $i < 32; $i++) {
            $statuses[] = $this->actingAs($user)
                ->postJson('/api/v1/auth/send-otp', ['email' => "flood{$i}@example.com"])
                ->status();
        }

        $this->assertContains(429, $statuses, 'a single IP must be capped across distinct OTP recipients');
    }
}
