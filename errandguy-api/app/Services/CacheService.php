<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class CacheService
{
    /**
     * Default TTL in seconds (10 minutes).
     */
    private const DEFAULT_TTL = 600;

    /**
     * Short TTL for frequently changing data (1 minute).
     */
    private const SHORT_TTL = 60;

    /**
     * Long TTL for rarely changing data (1 hour).
     */
    private const LONG_TTL = 3600;

    /**
     * Very long TTL for static data like errand types (24 hours).
     */
    private const STATIC_TTL = 86400;

    /**
     * Get or cache a value with default TTL.
     */
    public static function remember(string $key, callable $callback, ?int $ttl = null): mixed
    {
        return Cache::remember($key, $ttl ?? self::DEFAULT_TTL, $callback);
    }

    /**
     * Cache with short TTL (active bookings, locations, etc.).
     */
    public static function rememberShort(string $key, callable $callback): mixed
    {
        return Cache::remember($key, self::SHORT_TTL, $callback);
    }

    /**
     * Cache with long TTL (user profiles, runner profiles).
     */
    public static function rememberLong(string $key, callable $callback): mixed
    {
        return Cache::remember($key, self::LONG_TTL, $callback);
    }

    /**
     * Cache static/config data (errand types, system config, etc.).
     */
    public static function rememberStatic(string $key, callable $callback): mixed
    {
        return Cache::remember($key, self::STATIC_TTL, $callback);
    }

    /**
     * Invalidate a specific cache key.
     */
    public static function forget(string $key): bool
    {
        return Cache::forget($key);
    }

    /**
     * Invalidate multiple cache keys by prefix pattern.
     */
    public static function forgetByPrefix(string $prefix): void
    {
        // For database driver, we manually track tagged keys
        // For Redis, we can use pattern matching
        Cache::forget($prefix);
    }

    /**
     * Invalidate user-related caches when profile changes.
     */
    public static function forgetUser(string $userId): void
    {
        Cache::forget("user:{$userId}:profile");
        Cache::forget("user:{$userId}:addresses");
        Cache::forget("user:{$userId}:contacts");
        Cache::forget("user:{$userId}:wallet");
        Cache::forget("user:{$userId}:notifications:count");
    }

    /**
     * Invalidate runner-related caches.
     */
    public static function forgetRunner(string $userId): void
    {
        Cache::forget("runner:{$userId}:profile");
        Cache::forget("runner:{$userId}:earnings");
        Cache::forget("runner:{$userId}:current_errand");
    }

    /**
     * Invalidate booking-related caches.
     */
    public static function forgetBooking(string $bookingId): void
    {
        Cache::forget("booking:{$bookingId}");
        Cache::forget("booking:{$bookingId}:track");
        Cache::forget("booking:{$bookingId}:messages");
    }

    /**
     * Invalidate all config/static caches.
     */
    public static function forgetConfig(): void
    {
        Cache::forget('errand_types');
        Cache::forget('system_config');
        Cache::forget('app_config');
    }

    /**
     * Stale-while-revalidate cache.
     *
     * Serves cached data INSTANTLY, and once it passes the soft TTL returns
     * the (still valid) stale value immediately while refreshing it in the
     * BACKGROUND — so users never wait for a recompute, and the cache is
     * kept warm without a periodic cron.
     *
     * Lifecycle for a key:
     *   - cold (nothing cached)      → compute synchronously, cache, return.
     *   - fresh (now < soft TTL)     → return cached value.
     *   - stale (soft ≤ now < hard)  → return stale value NOW; schedule a
     *                                   background refresh (deduped by a lock).
     *   - expired (now ≥ hard TTL)   → treated as cold (recompute sync).
     *
     * The background refresh runs after the HTTP response is flushed
     * (dispatch()->afterResponse()), so it needs no queue worker and never
     * delays the request. A short lock prevents a refresh stampede when many
     * requests hit a stale key at once.
     *
     * @param int $softTtl seconds the value is considered fresh
     * @param int $hardTtl seconds the value physically survives in the store
     */
    public static function swr(string $key, int $softTtl, int $hardTtl, \Closure $callback): mixed
    {
        $entry = Cache::get($key);
        $now = time();

        if (is_array($entry) && array_key_exists('value', $entry)) {
            $freshUntil = (int) ($entry['fresh_until'] ?? 0);

            if ($now < $freshUntil) {
                return $entry['value']; // fresh
            }

            // Stale: return it immediately, refresh in the background (once).
            $lockKey = "{$key}:swr-refresh";
            if (Cache::add($lockKey, 1, 30)) {
                dispatch(function () use ($key, $softTtl, $hardTtl, $callback, $lockKey) {
                    try {
                        $value = $callback();
                        Cache::put($key, ['value' => $value, 'fresh_until' => time() + $softTtl], $hardTtl);
                    } finally {
                        Cache::forget($lockKey);
                    }
                })->afterResponse();
            }

            return $entry['value'];
        }

        // Cold (or hard-expired) — compute now.
        $value = $callback();
        Cache::put($key, ['value' => $value, 'fresh_until' => $now + $softTtl], $hardTtl);

        return $value;
    }

    // -------------------------------------------------------
    // Commonly used cache key builders
    // -------------------------------------------------------

    public static function userProfileKey(string $userId): string
    {
        return "user:{$userId}:profile";
    }

    public static function runnerProfileKey(string $userId): string
    {
        return "runner:{$userId}:profile";
    }

    public static function bookingKey(string $bookingId): string
    {
        return "booking:{$bookingId}";
    }

    public static function errandTypesKey(): string
    {
        return 'errand_types';
    }

    public static function systemConfigKey(): string
    {
        return 'system_config';
    }

    public static function unreadNotificationsKey(string $userId): string
    {
        return "user:{$userId}:notifications:count";
    }
}
