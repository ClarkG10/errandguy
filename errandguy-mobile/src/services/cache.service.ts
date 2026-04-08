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
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const data = await fetcher();
    await this.set(key, data, ttl);
    return data;
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
