<?php

namespace Tests\Feature\Middleware;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * The public trip-share / SOS link carries an unauthenticated token in the URL
 * path (GET /api/v1/trip/{token}). The request logger must NEVER persist that
 * token: it logs the route TEMPLATE, not the resolved URL — even on the error
 * path a bad/expired link takes. Regression guard for the log-hygiene fix.
 */
class LogApiRequestsRedactionTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_trip_token_is_not_written_to_the_request_log(): void
    {
        Log::spy();

        $token = 'super-secret-live-location-token-abc123';
        // Invalid token -> the controller returns 404, which is the exact
        // (isError) path that used to log the full URL including the token.
        $this->getJson("/api/v1/trip/{$token}")->assertStatus(404);

        Log::shouldHaveReceived('warning')->withArgs(function ($message, $context = []) use ($token) {
            if ($message !== 'API Error Response') {
                return false;
            }
            // The token must not appear ANYWHERE in the logged context...
            if (str_contains(json_encode($context), $token)) {
                return false;
            }
            // ...and the url field must be the redacted route template.
            return isset($context['url']) && str_contains($context['url'], '{token}');
        });
    }
}
