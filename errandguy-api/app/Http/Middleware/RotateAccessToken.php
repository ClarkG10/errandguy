<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sliding session: refresh a mobile access token before it can expire under an
 * active user.
 *
 * `SANCTUM_EXPIRATION` is 30 days and nothing ever renewed it, so EVERY user —
 * including someone who opens the app daily — was signed out exactly 30 days
 * after their last password entry. It is a hard cliff with no warning, and the
 * moment it lands is arbitrary: mid-errand while a runner is en route, mid
 * checkout, or on the tracking screen of an errand already paid for. The user
 * has no way to see it coming and no way to prevent it.
 *
 * Rotation is emitted as an ADDITIVE response header (`X-New-Token`). A client
 * that ignores it keeps working exactly as before; the app swaps the stored
 * token when it sees one.
 *
 * The OLD token is deliberately left alive to expire on its own. Deleting it
 * here would break every request already in flight with it — the app fires
 * several concurrent calls per screen — and it has at most
 * `ROTATE_WITHIN_DAYS` of life left anyway. `sanctum:prune-expired` reaps them.
 *
 * NOT rotated:
 *   • Admin tokens. AdminAuthController issues them with an explicit 8-hour
 *     `expires_at` and the `admin` ability — a deliberate decision from the
 *     2026-08-13 audit. A sliding admin session would quietly undo it.
 *   • Tokens with an explicit `expires_at`, for the same reason generalised:
 *     an expiry someone set on purpose is not ours to extend.
 */
class RotateAccessToken
{
    /**
     * Rotate once the token has less than this much life left. Generous on
     * purpose: a user who opens the app even once a week never sees a logout,
     * and a token that has been idle longer than this still gets refreshed on
     * the next request it makes.
     */
    private const ROTATE_WITHIN_DAYS = 7;

    /**
     * One rotation per user per window, enforced with an atomic cache lock.
     * Without it, the handful of concurrent requests the app fires on a cold
     * start would each mint a token.
     */
    private const ROTATION_LOCK_SECONDS = 300;

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Best-effort, always. A session refresh must never be able to fail a
        // request that has already been handled successfully.
        try {
            $this->maybeRotate($request, $response);
        } catch (\Throwable $e) {
            Log::warning('Access-token rotation skipped', ['reason' => $e->getMessage()]);
        }

        return $response;
    }

    private function maybeRotate(Request $request, Response $response): void
    {
        $user = $request->user();
        if (! $user) {
            return;
        }

        $token = $user->currentAccessToken();
        if (! $token instanceof PersonalAccessToken) {
            return;
        }

        // An expiry set deliberately at creation (admin: 8h) is not ours to slide.
        //
        // The admin check reads the abilities array directly and does NOT use
        // $token->can('admin'): Sanctum's can() short-circuits to true for a
        // wildcard token, so every mobile ['*'] token looked like an admin
        // token and nothing was ever rotated.
        if ($token->expires_at !== null || in_array('admin', (array) $token->abilities, true)) {
            return;
        }

        $lifetimeMinutes = (int) config('sanctum.expiration', 0);
        if ($lifetimeMinutes <= 0) {
            // Tokens never expire — nothing to refresh.
            return;
        }

        $expiresAt = $token->created_at->copy()->addMinutes($lifetimeMinutes);
        if ($expiresAt->gt(now()->addDays(self::ROTATE_WITHIN_DAYS))) {
            return;
        }

        // Only one request in a burst mints the replacement. Cache::add is
        // atomic; if the lock is already held, another request is handling it
        // (or just did) and this one leaves the header off.
        if (! Cache::add("token_rotate:{$user->id}", 1, self::ROTATION_LOCK_SECONDS)) {
            return;
        }

        $fresh = $user->createToken(
            $token->name ?: (string) $request->header('User-Agent', 'mobile'),
            $token->abilities ?? ['*'],
        );

        // The header is the ONLY place this value appears. It is never logged:
        // LogApiRequests redacts request payloads, and response headers are not
        // part of what it records.
        $response->headers->set('X-New-Token', $fresh->plainTextToken);
    }
}
