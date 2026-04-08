<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SocialLoginTest extends TestCase
{
    use RefreshDatabase;

    // ── Google Login ──────────────────────────────────────────

    public function test_google_login_creates_new_user(): void
    {
        Http::fake([
            'oauth2.googleapis.com/tokeninfo*' => Http::response([
                'email' => 'google-user@example.com',
                'name' => 'Google User',
                'picture' => 'https://example.com/avatar.jpg',
            ]),
        ]);

        $response = $this->postJson('/api/v1/auth/social-login', [
            'provider' => 'google',
            'token' => 'fake-google-token',
        ]);

        $response->assertOk()
            ->assertJsonStructure(['user', 'token']);

        $this->assertDatabaseHas('users', [
            'email' => 'google-user@example.com',
            'full_name' => 'Google User',
            'role' => 'customer',
            'email_verified' => true,
        ]);
    }

    public function test_google_login_links_existing_user(): void
    {
        $user = User::factory()->create(['email' => 'existing@example.com']);

        Http::fake([
            'oauth2.googleapis.com/tokeninfo*' => Http::response([
                'email' => 'existing@example.com',
                'name' => 'Existing User',
                'picture' => 'https://example.com/avatar.jpg',
            ]),
        ]);

        $response = $this->postJson('/api/v1/auth/social-login', [
            'provider' => 'google',
            'token' => 'fake-google-token',
        ]);

        $response->assertOk()
            ->assertJsonStructure(['user', 'token']);

        $this->assertDatabaseCount('users', 1);
    }

    public function test_google_login_fails_with_invalid_token(): void
    {
        Http::fake([
            'oauth2.googleapis.com/tokeninfo*' => Http::response([], 400),
        ]);

        $response = $this->postJson('/api/v1/auth/social-login', [
            'provider' => 'google',
            'token' => 'invalid-token',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['token']);
    }

    // ── Facebook Login ────────────────────────────────────────

    public function test_facebook_login_creates_new_user(): void
    {
        Http::fake([
            'graph.facebook.com/me*' => Http::response([
                'email' => 'fb-user@example.com',
                'name' => 'Facebook User',
                'picture' => ['data' => ['url' => 'https://example.com/fb-avatar.jpg']],
            ]),
        ]);

        $response = $this->postJson('/api/v1/auth/social-login', [
            'provider' => 'facebook',
            'token' => 'fake-fb-token',
        ]);

        $response->assertOk()
            ->assertJsonStructure(['user', 'token']);

        $this->assertDatabaseHas('users', [
            'email' => 'fb-user@example.com',
            'full_name' => 'Facebook User',
            'email_verified' => true,
        ]);
    }

    public function test_facebook_login_fails_with_invalid_token(): void
    {
        Http::fake([
            'graph.facebook.com/me*' => Http::response([], 401),
        ]);

        $response = $this->postJson('/api/v1/auth/social-login', [
            'provider' => 'facebook',
            'token' => 'invalid-token',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['token']);
    }

    // ── Suspended User ────────────────────────────────────────

    public function test_social_login_rejects_suspended_user(): void
    {
        User::factory()->create([
            'email' => 'suspended@example.com',
            'status' => 'suspended',
        ]);

        Http::fake([
            'oauth2.googleapis.com/tokeninfo*' => Http::response([
                'email' => 'suspended@example.com',
                'name' => 'Suspended',
            ]),
        ]);

        $response = $this->postJson('/api/v1/auth/social-login', [
            'provider' => 'google',
            'token' => 'fake-token',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }

    // ── Validation ────────────────────────────────────────────

    public function test_social_login_requires_provider(): void
    {
        $response = $this->postJson('/api/v1/auth/social-login', [
            'token' => 'some-token',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['provider']);
    }

    public function test_social_login_requires_token(): void
    {
        $response = $this->postJson('/api/v1/auth/social-login', [
            'provider' => 'google',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['token']);
    }

    public function test_social_login_rejects_invalid_provider(): void
    {
        $response = $this->postJson('/api/v1/auth/social-login', [
            'provider' => 'twitter',
            'token' => 'some-token',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['provider']);
    }
}
