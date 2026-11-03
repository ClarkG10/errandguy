import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/** TTL presets in milliseconds */
export const CacheTTL = {
  /** 1 minute — active bookings, runner locations */
  SHORT: 60 * 1000,
  /** 5 minutes — user profile, notifications count */
  MEDIUM: 5 * 60 * 1000,
  /** 30 minutes — booking history, earnings */
  LONG: 30 * 60 * 1000,
  /** 24 hours — errand types, app config, static data */
  STATIC: 24 * 60 * 60 * 1000,
} as const;

const CACHE_PREFIX = '@errandguy_cache:';

/** Keys read per multiGet while pruning — bounded so one call never pulls
 *  the whole store across the bridge at once. */
const PRUNE_CHUNK = 50;

/** getOrFetch calls currently fetching, so concurrent misses share one. */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Lightweight caching layer on top of AsyncStorage with TTL support.
 * Prevents unnecessary API calls and reduces load.
 */
export const CacheService = {
  /**
   * Get cached data. Returns null if expired or not found.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;

      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        // Expired — clean up in background
        AsyncStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }

      return entry.data;
    } catch {
      return null;
    }
  },

  /**
   * Store data with a TTL.
   */
  async set<T>(key: string, data: T, ttl: number = CacheTTL.MEDIUM): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        expiresAt: Date.now() + ttl,
      };
      await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Silently fail — cache is not critical
    }
  },

  /**
   * Get cached data or fetch it. If cache miss or expired, call fetcher and cache result.
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = CacheTTL.MEDIUM,
  ): Promise<T> {
    // Concurrent misses on one key share a single fetch instead of each
    // paying for its own (two screens geocoding the same pin on mount).
    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const run = (async () => {
      try {
        const cached = await this.get<T>(key);
        if (cached !== null) return cached;

        const data = await fetcher();
        await this.set(key, data, ttl);
        return data;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, run);
    return run;
  },

  /**
   * Drop every expired or unreadable entry under the cache prefix.
   *
   * `get` only removes an expired entry when that exact key is read again, so
   * anything keyed by something that never recurs (a coordinate, a one-off
   * search) stays on disk forever. Android caps AsyncStorage at 6 MB, and once
   * it is full EVERY setItem in the app throws — and `set` swallows that, so
   * caching, drafts and queued work all stop persisting with no visible error.
   * Run once per launch. Returns how many entries were removed; never throws.
   */
  async pruneExpired(now: number = Date.now()): Promise<number> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));
      const doomed: string[] = [];
      for (let i = 0; i < cacheKeys.length; i += PRUNE_CHUNK) {
        const pairs = await AsyncStorage.multiGet(cacheKeys.slice(i, i + PRUNE_CHUNK));
        for (const [k, raw] of pairs) {
          if (raw == null) continue;
          let expiresAt: unknown;
          try {
            expiresAt = (JSON.parse(raw) as Partial<CacheEntry<unknown>> | null)?.expiresAt;
          } catch {
            doomed.push(k); // corrupt — `get` could never return it anyway
            continue;
          }
          if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || now > expiresAt) {
            doomed.push(k);
          }
        }
      }
      if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
      return doomed.length;
    } catch {
      // Housekeeping only — a failure here must never break launch.
      return 0;
    }
  },

  /**
   * Remove a specific cache entry.
   */
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(CACHE_PREFIX + key);
    } catch {
      // Silently fail
    }
  },

  /**
   * Remove all cache entries matching a prefix (e.g., 'user:123').
   */
  async removeByPrefix(prefix: string): Promise<void> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const matchingKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX + prefix));
      if (matchingKeys.length > 0) {
        await AsyncStorage.multiRemove(matchingKeys);
      }
    } catch {
      // Silently fail
    }
  },

  /**
   * Invalidate all user-related caches.
   */
  async invalidateUser(userId: string): Promise<void> {
    await this.removeByPrefix(`user:${userId}`);
  },

  /**
   * Invalidate booking-related caches.
   */
  async invalidateBooking(bookingId: string): Promise<void> {
    await this.removeByPrefix(`booking:${bookingId}`);
  },

  /**
   * Clear all cached data (e.g., on logout).
   */
  async clearAll(): Promise<void> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
    } catch {
      // Silently fail
    }
  },
};

// Common cache key builders
export const CacheKeys = {
  userProfile: (userId: string) => `user:${userId}:profile`,
  runnerProfile: (userId: string) => `runner:${userId}:profile`,
  booking: (bookingId: string) => `booking:${bookingId}`,
  bookingHistory: (userId: string) => `user:${userId}:bookings`,
  errandTypes: () => 'errand_types',
  appConfig: () => 'app_config',
  unreadCount: (userId: string) => `user:${userId}:unread`,
  walletBalance: (userId: string) => `user:${userId}:wallet`,
  savedAddresses: (userId: string) => `user:${userId}:addresses`,
  earnings: (userId: string, period: string) => `runner:${userId}:earnings:${period}`,
};
