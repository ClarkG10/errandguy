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
    public const BADGE_VERIFICATIONS = 'admin:badge:verifications';
    public const QUEUE = 'admin:dashboard:queue';
    public const TOP_RUNNERS = 'admin:dashboard:top-runners';
    public const CHART_REVENUE = 'admin:chart:revenue';
    public const CHART_BOOKINGS = 'admin:chart:bookings';
    public const CHART_STATUS = 'admin:chart:status';
    public const CHART_PAYMENT_MIX = 'admin:chart:payment-mix';
    public const CHART_USER_GROWTH = 'admin:chart:user-growth';

    private const KEYS = [
        self::STATS,
        self::BADGE_SOS,
        self::BADGE_DISPUTES,
        self::BADGE_SUPPORT,
        self::BADGE_PAYOUTS,
        self::BADGE_VERIFICATIONS,
        self::QUEUE,
        self::TOP_RUNNERS,
        self::CHART_REVENUE,
        self::CHART_BOOKINGS,
        self::CHART_STATUS,
        self::CHART_PAYMENT_MIX,
        self::CHART_USER_GROWTH,
    ];

    /** Cache a value under $key for the short (60s) TTL. */
    public static function remember(string $key, callable $callback): mixed
    {
        return CacheService::rememberShort($key, $callback);
    }

    /** Cache a value under $key for a custom TTL (e.g. charts change slowly). */
    public static function rememberFor(string $key, int $ttl, callable $callback): mixed
    {
        return CacheService::remember($key, $callback, $ttl);
    }

    /** Invalidate all admin dashboard/badge caches (call after a mutation). */
    public static function flush(): void
    {
        foreach (self::KEYS as $key) {
            CacheService::forget($key);
        }
    }
}
