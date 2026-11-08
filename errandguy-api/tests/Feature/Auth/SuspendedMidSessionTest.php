<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\UserModerationService;
use App\Support\ErrorCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Suspending someone revokes their sign-ins, so their phone's next request was
 * a plain 401 — read by the app as an expired session. A user suspended while
 * using the app was dropped to the Welcome screen with no reason, and learnt it
 * only by trying to sign in again. The revoked sign-in now answers with the
 * same ACCOUNT_SUSPENDED 403 a live one gets, which the app shows.
 */
class SuspendedMidSessionTest extends TestCase
{
    use RefreshDatabase;

    private function profileAs(string $bearer)
    {
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', 'Bearer '.$bearer)->getJson('/api/v1/user/profile');
    }

    public function test_the_phone_that_was_signed_in_is_told_it_was_suspended(): void
    {
        Cache::flush();
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $token = $user->createToken('device:phone-123456')->plainTextToken;
        $this->profileAs($token)->assertOk();

        app(UserModerationService::class)->suspend($user, 'Fraud report');

        $this->assertSame(0, $user->tokens()->count(), 'the sign-in is still revoked');
        $this->profileAs($token)
            ->assertStatus(403)
            ->assertJsonPath('code', ErrorCode::ACCOUNT_SUSPENDED->value);
    }

    public function test_only_the_real_sign_in_gets_the_reason(): void
    {
        Cache::flush();
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $token = $user->createToken('device:phone-123456')->plainTextToken;
        app(UserModerationService::class)->suspend($user, 'Fraud report');

        // Same token id, wrong secret: nothing to learn about the account.
        [$id] = explode('|', $token, 2);
        $this->profileAs($id.'|not-the-secret')
            ->assertStatus(401)
            ->assertJsonPath('code', ErrorCode::UNAUTHENTICATED->value);
        $this->profileAs('no-bar-at-all')->assertStatus(401);
    }

    public function test_once_unsuspended_the_old_sign_in_is_simply_expired(): void
    {
        Cache::flush();
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $token = $user->createToken('device:phone-123456')->plainTextToken;
        app(UserModerationService::class)->suspend($user, 'Fraud report');
        $user->forceFill(['status' => 'active', 'suspended_at' => null, 'suspended_reason' => null])->save();

        $this->profileAs($token)
            ->assertStatus(401)
            ->assertJsonPath('code', ErrorCode::UNAUTHENTICATED->value);
    }
}
