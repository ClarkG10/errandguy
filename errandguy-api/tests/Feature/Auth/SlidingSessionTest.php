<?php

namespace Tests\Feature\Auth;

use App\Http\Middleware\RotateAccessToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * Sliding session.
 *
 * SANCTUM_EXPIRATION is 30 days and nothing ever renewed it, so every user —
 * including one who opened the app daily — was signed out exactly 30 days after
 * their last password entry, at an arbitrary moment: mid-errand with a runner
 * en route, mid-checkout, or on the tracking screen of an errand already paid
 * for. RotateAccessToken mints a replacement as expiry approaches and returns
 * it in an additive `X-New-Token` header.
 *
 * The properties that matter, and why:
 *   • Near expiry → a header appears, and it is a WORKING token.
 *   • Far from expiry → no header (this runs on every authenticated request;
 *     minting per request would be pure write load).
 *   • The OLD token keeps working — the app fires several concurrent requests
 *     per screen, and revoking mid-flight would 401 them.
 *   • A deliberate expiry (admin: 8h, from the 2026-08-13 audit) is never slid.
 *   • Concurrent requests rotate ONCE.
 */
class SlidingSessionTest extends TestCase
{
    use RefreshDatabase;

    /** Full configured token lifetime, in minutes. */
    private function lifetime(): int
    {
        return (int) config('sanctum.expiration');
    }

    /**
     * Run the middleware for a user whose token was created `$ageDays` ago.
     *
     * @return array{0: \Symfony\Component\HttpFoundation\Response, 1: User, 2: PersonalAccessToken}
     */
    private function runWithTokenAged(float $ageDays, array $abilities = ['*'], ?string $expiresAt = null): array
    {
        $user = User::factory()->create(['status' => 'active']);

        $new = $user->createToken('mobile', $abilities, $expiresAt ? now()->parse($expiresAt) : null);
        $token = PersonalAccessToken::findToken($new->plainTextToken);
        $token->forceFill(['created_at' => now()->subMinutes((int) round($ageDays * 1440))])->save();
        $token->refresh();

        $user->withAccessToken($token);

        $request = Request::create('/api/v1/bookings', 'GET');
        $request->setUserResolver(fn () => $user);

        $response = (new RotateAccessToken())->handle(
            $request,
            fn ($req) => response()->json(['ok' => true]),
        );

        return [$response, $user, $token];
    }

    public function test_a_token_near_expiry_is_refreshed(): void
    {
        // 30-day lifetime, 27 days old → 3 days left, inside the 7-day window.
        [$response, $user] = $this->runWithTokenAged(($this->lifetime() / 1440) - 3);

        $fresh = $response->headers->get('X-New-Token');
        $this->assertNotNull($fresh, 'a token about to expire must be refreshed');

        // It must be a REAL, usable token for the SAME user — a header carrying
        // a broken value would be worse than no header at all.
        $parsed = PersonalAccessToken::findToken($fresh);
        $this->assertNotNull($parsed);
        $this->assertSame($user->id, $parsed->tokenable_id);
        $this->assertTrue($parsed->created_at->isAfter(now()->subMinute()));
    }

    public function test_a_token_with_plenty_of_life_left_is_not_touched(): void
    {
        [$response] = $this->runWithTokenAged(1);

        $this->assertNull($response->headers->get('X-New-Token'));
        // One token, not two: this middleware runs on EVERY authenticated
        // request, so rotating early would be pure write load.
        $this->assertSame(1, PersonalAccessToken::count());
    }

    /**
     * The app fires several concurrent requests per screen. Revoking the old
     * token at rotation time would 401 every one already in flight with it.
     */
    public function test_the_previous_token_keeps_working_after_rotation(): void
    {
        [$response, , $old] = $this->runWithTokenAged(($this->lifetime() / 1440) - 1);

        $this->assertNotNull($response->headers->get('X-New-Token'));
        $this->assertNotNull(
            PersonalAccessToken::find($old->id),
            'the in-flight token must survive its own replacement',
        );
    }

    /**
     * Admin tokens carry an explicit 8h expires_at (2026-08-13 audit). Sliding
     * them would quietly undo that decision.
     */
    public function test_a_token_with_a_deliberate_expiry_is_never_slid(): void
    {
        [$response] = $this->runWithTokenAged(
            ($this->lifetime() / 1440) - 1,
            ['admin'],
            now()->addMinutes(5)->toDateTimeString(),
        );

        $this->assertNull($response->headers->get('X-New-Token'));
    }

    public function test_an_admin_ability_token_is_never_slid_even_without_an_expiry(): void
    {
        [$response] = $this->runWithTokenAged(($this->lifetime() / 1440) - 1, ['admin']);

        $this->assertNull($response->headers->get('X-New-Token'));
    }

    /**
     * A cold start fires a burst of requests, all with the same near-expiry
     * token. Exactly one may mint a replacement.
     */
    public function test_concurrent_requests_rotate_only_once(): void
    {
        $user = User::factory()->create(['status' => 'active']);
        $new = $user->createToken('mobile');
        $token = PersonalAccessToken::findToken($new->plainTextToken);
        $token->forceFill(['created_at' => now()->subMinutes($this->lifetime() - 1440)])->save();
        $token->refresh();
        $user->withAccessToken($token);

        $request = Request::create('/api/v1/bookings', 'GET');
        $request->setUserResolver(fn () => $user);

        $headers = [];
        for ($i = 0; $i < 4; $i++) {
            $headers[] = (new RotateAccessToken())
                ->handle($request, fn ($req) => response()->json(['ok' => true]))
                ->headers->get('X-New-Token');
        }

        $this->assertCount(1, array_filter($headers), 'only one request in a burst may mint a token');
        // Original + exactly one replacement.
        $this->assertSame(2, PersonalAccessToken::where('tokenable_id', $user->id)->count());
    }

    /**
     * The refresh is a convenience layered on an already-successful response.
     * If the cache backend (the rotation lock) is down, the request must still
     * be served — this middleware sits on every authenticated route.
     */
    public function test_a_cache_outage_does_not_fail_the_request(): void
    {
        $user = User::factory()->create(['status' => 'active']);
        $new = $user->createToken('mobile');
        $token = PersonalAccessToken::findToken($new->plainTextToken);
        $token->forceFill(['created_at' => now()->subMinutes($this->lifetime() - 60)])->save();
        $token->refresh();
        $user->withAccessToken($token);

        Cache::shouldReceive('add')->andThrow(new \RuntimeException('redis down'));

        $request = Request::create('/api/v1/bookings', 'GET');
        $request->setUserResolver(fn () => $user);

        $response = (new RotateAccessToken())->handle(
            $request,
            fn ($req) => response()->json(['ok' => true]),
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertNull($response->headers->get('X-New-Token'));
    }

    public function test_an_unauthenticated_response_is_left_alone(): void
    {
        $request = Request::create('/api/v1/bookings', 'GET');
        $request->setUserResolver(fn () => null);

        $response = (new RotateAccessToken())->handle(
            $request,
            fn ($req) => response()->json(['message' => 'Unauthenticated.'], 401),
        );

        $this->assertSame(401, $response->getStatusCode());
        $this->assertNull($response->headers->get('X-New-Token'));
    }
}
