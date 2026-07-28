<?php

namespace App\Support;

use App\Services\CacheService;

/**
 * Small Redis-backed cache for the admin panel's hot, per-render aggregates
 * (dashboard stats + sidebar nav badges). These COUNT/SUM queries otherwise run
 * on EVERY page and Livewire action against the remote Supabase DB, which is the
 * main source of admin sluggishness. Cached for 60s (CacheService::rememberShort)
 * and flushed after any mutating admin action so numbers stay fresh.
 */
class AdminCache
{
    public const STATS = 'admin:stats:overview';
    public const BADGE_SOS = 'admin:badge:sos';
    public const BADGE_DISPUTES = 'admin:badge:disputes';
    public const BADGE_SUPPORT = 'admin:badge:support';
    public const BADGE_PAYOUTS = 'admin:badge:payouts';

    private const KEYS = [
        self::STATS,
        self::BADGE_SOS,
        self::BADGE_DISPUTES,
        self::BADGE_SUPPORT,
        self::BADGE_PAYOUTS,
    ];

    /** Cache a value under $key for the short (60s) TTL. */
    public static function remember(string $key, callable $callback): mixed
    {
        return CacheService::rememberShort($key, $callback);
    }

    /** Invalidate all admin dashboard/badge caches (call after a mutation). */
    public static function flush(): void
    {
        foreach (self::KEYS as $key) {
            CacheService::forget($key);
        }
    }
}
