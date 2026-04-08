<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class LoginTest extends TestCase
{
    use RefreshDatabase;

    private array $validData;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create([
            'phone' => '+639171234567',
            'email' => 'login@example.com',
            'password_hash' => Hash::make('Password1!'),
        ]);

        $this->validData = [
            'phone' => '+639171234567',
            'password' => 'Password1!',
        ];
    }

    public function test_user_can_login_with_phone(): void
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'phone' => '+639171234567',
            'password' => 'Password1!',
        ]);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'user' => ['id', 'full_name', 'email', 'phone', 'role'],
                'token',
            ]);
    }

    public function test_user_can_login_with_email(): void
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'email' => 'login@example.com',
            'password' => 'Password1!',
        ]);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'user' => ['id', 'full_name', 'email', 'phone', 'role'],
                'token',
            ]);
    }

    public function test_login_returns_sanctum_token(): void
    {
        $response = $this->postJson('/api/v1/auth/login', $this->validData);

        $response->assertStatus(200);
        $this->assertNotEmpty($response->json('token'));
    }

    public function test_login_updates_last_active_at(): void
    {
        $this->assertNull($this->user->last_active_at);

        $this->postJson('/api/v1/auth/login', $this->validData);

        $this->user->refresh();
        $this->assertNotNull($this->user->last_active_at);
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'phone' => '+639171234567',
            'password' => 'WrongPassword1!',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['credentials']);
    }

    public function test_login_fails_with_nonexistent_user(): void
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'email' => 'nobody@example.com',
            'password' => 'Password1!',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['credentials']);
    }

    public function test_login_fails_without_password(): void
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'phone' => '+639171234567',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['password']);
    }

    public function test_login_fails_without_phone_or_email(): void
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'password' => 'Password1!',
        ]);

        $response->assertStatus(422);
    }

    public function test_suspended_user_cannot_login(): void
    {
        $this->user->update(['status' => 'suspended']);

        $response = $this->postJson('/api/v1/auth/login', $this->validData);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['status']);
    }

    public function test_banned_user_cannot_login(): void
    {
        $this->user->update(['status' => 'banned']);

        $response = $this->postJson('/api/v1/auth/login', $this->validData);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['status']);
    }

    public function test_brute_force_lockout_after_five_attempts(): void
    {
        // Make 5 failed login attempts
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/login', [
                'phone' => '+639171234567',
                'password' => 'WrongPassword!',
            ]);
        }

        // 6th attempt should be rate-limited even with correct password
        $response = $this->postJson('/api/v1/auth/login', $this->validData);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['email']);
    }

    public function test_successful_login_clears_rate_limit(): void
    {
        // Make 3 failed attempts
        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/auth/login', [
                'phone' => '+639171234567',
                'password' => 'WrongPassword!',
            ]);
        }

        // Successful login should clear the counter
        $this->postJson('/api/v1/auth/login', $this->validData)
            ->assertStatus(200);

        // Verify cache is cleared
        $key = 'login_attempts:+639171234567';
        $this->assertNull(Cache::get($key));
    }

    public function test_login_revokes_existing_device_tokens(): void
    {
        // First login
        $this->postJson('/api/v1/auth/login', array_merge($this->validData, [
            'device_name' => 'test-device',
        ]));

        $this->assertEquals(1, $this->user->tokens()->where('name', 'test-device')->count());

        // Second login with same device name
        $this->postJson('/api/v1/auth/login', array_merge($this->validData, [
            'device_name' => 'test-device',
        ]));

        // Should still only have 1 token for this device
        $this->assertEquals(1, $this->user->tokens()->where('name', 'test-device')->count());
    }
}
