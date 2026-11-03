<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * Sanctum writes personal_access_tokens.last_used_at on every authenticated
 * request by default — a row write on every runner GPS ping. Nothing reads it,
 * so it is off (config/sanctum.php `last_used_at`).
 */
class TokenLastUsedTrackingTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_authenticated_request_does_not_write_to_its_token(): void
    {
        $this->assertFalse(config('sanctum.last_used_at'));

        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $plain = $user->createToken('phone')->plainTextToken;

        $this->withHeader('Authorization', "Bearer {$plain}")
            ->getJson('/api/v1/user/trusted-contacts')
            ->assertOk();

        $this->assertNull(PersonalAccessToken::firstOrFail()->last_used_at);
    }
}
