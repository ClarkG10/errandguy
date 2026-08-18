<?php

namespace Tests\Feature\Middleware;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Regression guard for the api rate limiter (bootstrap/app.php): authenticated
 * clients get 240/min-by-user, anonymous get 20/min-by-IP. Even though the api
 * group's throttle and the route's auth:sanctum are group- vs route-level, the
 * framework's middleware priority runs Authenticate BEFORE ThrottleRequests, so
 * $request->user() is already resolved when the limiter runs — an authenticated
 * bearer request is correctly classified at 240/min, not the 20/min anon limit.
 * Uses a REAL bearer token (not Sanctum::actingAs, which overrides the request
 * user resolver) so the true auth→throttle ordering is exercised. This catches a
 * regression if that ordering, the limiter keying, or the guard wiring changes.
 */
class ApiRateLimitGuardTest extends TestCase
{
    use RefreshDatabase;

    public function test_bearer_authenticated_requests_get_the_higher_api_rate_limit(): void
    {
        Cache::flush(); // the rate limiter counts in the cache — start clean

        $user = User::factory()->create(['status' => 'active']);
        $token = $user->createToken('test-device')->plainTextToken;

        // 25 back-to-back authenticated requests from one IP. If the limiter
        // mis-resolved the user (null → 20/min by IP), the 21st would be 429.
        // The authenticated limit is 240/min, so all 25 must pass.
        $codes = [];
        for ($i = 0; $i < 25; $i++) {
            $codes[] = $this->withHeader('Authorization', 'Bearer ' . $token)
                ->getJson('/api/v1/user/profile')
                ->getStatusCode();
        }

        $this->assertNotContains(
            429,
            $codes,
            'authenticated bearer requests must use the 240/min limit, not the 20/min anon limit',
        );
    }
}
