<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * QA-2: password reset is an account-takeover surface and had no test coverage
 * while its files were being actively changed. Lock the security-critical
 * invariants: a valid token resets the password AND revokes every existing
 * session; a token is single-use; an expired or wrong token is rejected.
 */
class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create([
            'email' => 'reset@example.com',
            'password_hash' => Hash::make('OldPass1!'),
        ]);
    }

    private function seedToken(string $raw, ?\Illuminate\Support\Carbon $createdAt = null): void
    {
        DB::table('password_reset_tokens')->updateOrInsert(
            ['email' => $this->user->email],
            ['token' => Hash::make($raw), 'created_at' => $createdAt ?? now()],
        );
    }

    private function reset(string $token, string $password = 'NewPass1!'): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/auth/reset-password', [
            'email' => $this->user->email,
            'token' => $token,
            'password' => $password,
            'password_confirmation' => $password,
        ]);
    }

    public function test_valid_token_resets_password_and_revokes_all_sessions(): void
    {
        $this->user->createToken('existing-device'); // a live session
        $this->assertSame(1, $this->user->tokens()->count());
        $this->seedToken('VALIDTOKEN');

        $this->reset('VALIDTOKEN')->assertOk();

        // Password actually changed.
        $this->assertTrue(Hash::check('NewPass1!', $this->user->fresh()->password_hash));
        $this->assertFalse(Hash::check('OldPass1!', $this->user->fresh()->password_hash));
        // Every existing session was revoked (an attacker who reset can't ride an old token).
        $this->assertSame(0, $this->user->fresh()->tokens()->count());
        // The reset token was consumed.
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => $this->user->email]);
    }

    public function test_token_is_single_use(): void
    {
        $this->seedToken('ONCE');
        $this->reset('ONCE')->assertOk();

        // Replaying the same token must fail — it was deleted on first use.
        $this->reset('ONCE')->assertStatus(422);
        // Password stays at the first reset value (a replay can't set it again).
        $this->assertTrue(Hash::check('NewPass1!', $this->user->fresh()->password_hash));
    }

    public function test_expired_token_is_rejected_and_purged(): void
    {
        $this->seedToken('OLD', now()->subHours(2)); // past the 1-hour deadline

        $this->reset('OLD')->assertStatus(422);

        $this->assertTrue(Hash::check('OldPass1!', $this->user->fresh()->password_hash), 'password must not change on an expired token');
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => $this->user->email]);
    }

    public function test_wrong_token_is_rejected(): void
    {
        $this->seedToken('CORRECT');

        $this->reset('WRONG')->assertStatus(422);

        $this->assertTrue(Hash::check('OldPass1!', $this->user->fresh()->password_hash));
        // The real token survives a wrong guess (not purged).
        $this->assertDatabaseHas('password_reset_tokens', ['email' => $this->user->email]);
    }
}
