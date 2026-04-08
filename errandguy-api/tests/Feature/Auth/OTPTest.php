<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\OTPService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class OTPTest extends TestCase
{
    use RefreshDatabase;

    // ── Send OTP ──────────────────────────────────────────────

    public function test_send_otp_via_phone(): void
    {
        $response = $this->postJson('/api/v1/auth/send-otp', [
            'phone' => '+639171234567',
        ]);

        $response->assertOk()
            ->assertJson(['message' => 'Verification code sent successfully.']);

        $this->assertTrue(Cache::has('otp:+639171234567'));
    }

    public function test_send_otp_via_email(): void
    {
        $response = $this->postJson('/api/v1/auth/send-otp', [
            'email' => 'test@example.com',
        ]);

        $response->assertOk()
            ->assertJson(['message' => 'Verification code sent successfully.']);

        $this->assertTrue(Cache::has('otp:test@example.com'));
    }

    public function test_send_otp_requires_phone_or_email(): void
    {
        $response = $this->postJson('/api/v1/auth/send-otp', []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['phone', 'email']);
    }

    public function test_send_otp_rejects_invalid_phone_format(): void
    {
        $response = $this->postJson('/api/v1/auth/send-otp', [
            'phone' => '12345',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['phone']);
    }

    public function test_send_otp_rejects_invalid_email(): void
    {
        $response = $this->postJson('/api/v1/auth/send-otp', [
            'email' => 'not-an-email',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
    }

    // ── Verify OTP ────────────────────────────────────────────

    public function test_verify_otp_for_existing_user_with_phone(): void
    {
        $user = User::factory()->create(['phone' => '+639171234567', 'phone_verified' => false]);

        // Store a known OTP
        $otp = '123456';
        Cache::put('otp:+639171234567', Hash::make($otp), now()->addMinutes(5));

        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639171234567',
            'code' => $otp,
        ]);

        $response->assertOk()
            ->assertJsonStructure(['message', 'user', 'token'])
            ->assertJson(['message' => 'Verification successful.']);

        $this->assertTrue($user->fresh()->phone_verified);
    }

    public function test_verify_otp_for_existing_user_with_email(): void
    {
        $user = User::factory()->create(['email' => 'test@example.com', 'email_verified' => false]);

        $otp = '654321';
        Cache::put('otp:test@example.com', Hash::make($otp), now()->addMinutes(5));

        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'email' => 'test@example.com',
            'code' => $otp,
        ]);

        $response->assertOk()
            ->assertJsonStructure(['message', 'user', 'token'])
            ->assertJson(['message' => 'Verification successful.']);

        $this->assertTrue($user->fresh()->email_verified);
    }

    public function test_verify_otp_without_existing_user_returns_verified_flag(): void
    {
        $otp = '111111';
        Cache::put('otp:+639999999999', Hash::make($otp), now()->addMinutes(5));

        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639999999999',
            'code' => $otp,
        ]);

        $response->assertOk()
            ->assertJson([
                'message' => 'Verification successful.',
                'verified' => true,
            ])
            ->assertJsonMissing(['token']);
    }

    public function test_verify_otp_fails_with_wrong_code(): void
    {
        Cache::put('otp:+639171234567', Hash::make('123456'), now()->addMinutes(5));

        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639171234567',
            'code' => '000000',
        ]);

        $response->assertUnprocessable()
            ->assertJson(['message' => 'Invalid verification code.']);
    }

    public function test_verify_otp_fails_when_expired(): void
    {
        // No OTP stored in cache (simulates expiry)
        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639171234567',
            'code' => '123456',
        ]);

        $response->assertUnprocessable()
            ->assertJson(['message' => 'Invalid verification code.']);
    }

    public function test_verify_otp_tracks_failed_attempts(): void
    {
        Cache::put('otp:+639171234567', Hash::make('123456'), now()->addMinutes(5));

        // First failed attempt
        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639171234567',
            'code' => '000000',
        ]);

        $response->assertUnprocessable()
            ->assertJsonFragment(['attempts_remaining' => 4]);

        // Second failed attempt
        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639171234567',
            'code' => '000000',
        ]);

        $response->assertUnprocessable()
            ->assertJsonFragment(['attempts_remaining' => 3]);
    }

    public function test_verify_otp_locks_after_five_attempts(): void
    {
        Cache::put('otp:+639171234567', Hash::make('123456'), now()->addMinutes(5));
        Cache::put('otp_attempts:+639171234567', 5, now()->addMinutes(5));

        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639171234567',
            'code' => '123456',
        ]);

        $response->assertUnprocessable()
            ->assertJson(['message' => 'Too many failed attempts. Please request a new code.']);
    }

    public function test_verify_otp_requires_code(): void
    {
        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639171234567',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['code']);
    }

    public function test_verify_otp_requires_six_digit_code(): void
    {
        $response = $this->postJson('/api/v1/auth/verify-otp', [
            'phone' => '+639171234567',
            'code' => '123',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['code']);
    }

    public function test_send_otp_resets_attempt_counter(): void
    {
        Cache::put('otp_attempts:+639171234567', 4, now()->addMinutes(5));

        $this->postJson('/api/v1/auth/send-otp', [
            'phone' => '+639171234567',
        ]);

        $this->assertEquals(0, Cache::get('otp_attempts:+639171234567', 0));
    }
}
