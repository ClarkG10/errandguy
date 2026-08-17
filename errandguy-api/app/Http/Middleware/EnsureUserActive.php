<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserActive
{
    /**
     * Ensure the authenticated user's account is active.
     * Updates last_active_at on each request, throttled via cache so
     * we don't write to the users table on every single API call
     * (the GPS push fires every ~5 s — without throttling we were
     * issuing ~720 user-row UPDATEs per hour per online runner, which
     * was the dominant write load on the database and the dominant
     * source of /runner/location latency).
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
            ], 401);
        }

        if ($user->status === 'suspended') {
            return response()->json([
                'success' => false,
                'message' => 'Your account has been suspended. Please contact support.',
            ], 403);
        }

        if ($user->status === 'banned') {
            return response()->json([
                'success' => false,
                'message' => 'Your account has been permanently banned.',
            ], 403);
        }

        if ($user->status === 'deleted') {
            return response()->json([
                'success' => false,
                'message' => 'This account no longer exists.',
            ], 403);
        }

        // Throttle the last_active_at write to once per minute per user.
        // Cache::add returns true only when the key did not previously
        // exist, so the UPDATE only runs once inside the TTL window.
        // 60 s is granular enough for "online" presence + admin "last
        // seen" UI, while collapsing thousands of background pings
        // into a single write.
        // Fail OPEN if the cache backend is unavailable. This middleware runs on
        // every authenticated request and the cache store (Redis in prod) is a
        // correlated dependency of the whole authed API — an un-guarded
        // Cache::add would turn a Redis blip into a 500 on every request. Presence
        // ("last seen") is a best-effort convenience, so on a cache error we skip
        // the throttled write and still serve the request.
        try {
            if (Cache::add("user_active_throttle:{$user->id}", 1, 60)) {
                // Use a targeted UPDATE (no model save) to avoid firing
                // observers / touching updated_at / refreshing the model.
                $user->newQuery()
                    ->whereKey($user->id)
                    ->update(['last_active_at' => now()]);
            }
        } catch (\Throwable $e) {
            // Cache (Redis) unavailable — skip the presence write, don't 500.
        }

        return $next($request);
    }
}
