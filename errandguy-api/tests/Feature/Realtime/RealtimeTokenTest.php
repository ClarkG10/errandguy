<?php

namespace Tests\Feature\Realtime;

use App\Models\User;
use App\Services\SupabaseTokenService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Supabase realtime JWT mint + endpoint (audit P6). The mint is inert (null)
 * until SUPABASE_JWT_SECRET is configured, so realtime stays anon by default.
 */
class RealtimeTokenTest extends TestCase
{
    use RefreshDatabase;

    public function test_mint_returns_null_when_secret_not_configured(): void
    {
        config(['services.supabase.jwt_secret' => null]);
        $user = User::factory()->create();

        $this->assertNull((new SupabaseTokenService())->mint($user));
    }

    public function test_mint_produces_a_valid_hs256_jwt_scoped_to_the_user(): void
    {
        config(['services.supabase.jwt_secret' => 'test-secret']);
        $user = User::factory()->create(['email' => 'runner@example.com']);

        $jwt = (new SupabaseTokenService())->mint($user, 3600);
        $this->assertNotNull($jwt);

        [$h, $p, $sig] = explode('.', $jwt);

        // Signature verifies with the configured secret.
        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', "{$h}.{$p}", 'test-secret', true)), '+/', '-_'), '=');
        $this->assertSame($expected, $sig);

        // Claims RLS depends on.
        $payload = json_decode(base64_decode(strtr($p, '-_', '+/')), true);
        $this->assertSame((string) $user->id, $payload['sub']);
        $this->assertSame('authenticated', $payload['role']);
        $this->assertSame('authenticated', $payload['aud']);
        $this->assertSame('runner@example.com', $payload['email']);
        $this->assertGreaterThan(time(), $payload['exp']);
    }

    public function test_endpoint_requires_authentication(): void
    {
        $this->getJson('/api/v1/realtime-token')->assertUnauthorized();
    }

    public function test_endpoint_returns_null_token_by_default_inert(): void
    {
        config(['services.supabase.jwt_secret' => null]);
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($user)
            ->getJson('/api/v1/realtime-token')
            ->assertOk()
            ->assertJsonPath('data.token', null)
            ->assertJsonPath('data.expires_in', null);
    }

    public function test_endpoint_issues_a_token_once_the_secret_is_configured(): void
    {
        config(['services.supabase.jwt_secret' => 'test-secret']);
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $response = $this->actingAs($user)
            ->getJson('/api/v1/realtime-token')
            ->assertOk()
            ->assertJsonPath('data.expires_in', 3600);

        $this->assertNotNull($response->json('data.token'));
    }
}
