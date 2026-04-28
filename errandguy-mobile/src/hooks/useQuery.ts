import { useCallback, useEffect, useRef, useState } from 'react';
import { CacheService, CacheTTL } from '../services/cache.service';
import { apiCache } from '../services/api';

/**
 * Stale-while-revalidate query hook.
 *
 *   const { data, loading, refresh, mutate } = useQuery(
 *     ['booking', id],
 *     () => bookingService.getBooking(id).then(r => r.data.data),
 *     { staleTime: 30_000, ttl: CacheTTL.MEDIUM }
 *   );
 *
 * Behaviour:
 *  1. On mount, returns whatever is in AsyncStorage immediately (no spinner).
 *  2. If the cached entry is older than `staleTime`, revalidates in the
 *     background and updates the UI when the response arrives.
 *  3. Returns `loading=true` ONLY when there is no cached value at all.
 *  4. `refresh()` forces a network fetch (used by pull-to-refresh).
 *  5. `mutate(updater)` updates both the in-memory state and the cache so
 *     the next mount sees the optimistic value.
 *  6. Mutations elsewhere call `invalidateQuery(prefix)` which both wipes
 *     the AsyncStorage entry AND notifies any mounted hooks whose key is
 *     prefixed by it so they revalidate in-place.
 */
export interface UseQueryOptions {
  /** How long the cached value is considered fresh (no revalidation). */
  staleTime?: number;
  /** AsyncStorage TTL — outside this, cache is treated as missing. */
  ttl?: number;
  /** When false, the hook does nothing. Useful for conditional queries. */
  enabled?: boolean;
}

export interface UseQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  isStale: boolean;
  refresh: () => Promise<void>;
  mutate: (updater: T | ((prev: T | null) => T)) => Promise<void>;
}

const META_PREFIX = 'q:';

const buildKey = (key: string | (string | number | null | undefined)[]) =>
  Array.isArray(key)
    ? META_PREFIX + key.filter((p) => p != null).join(':')
    : META_PREFIX + key;

interface CachedEntry<T> {
  value: T;
  fetchedAt: number;
}

// ── In-process pub/sub for invalidation ─────────────────────────────────
// Keyed by the full cacheKey (`q:bookings:recent:<userId>`). Each entry is
// the set of subscriber callbacks. We also track active prefixes to avoid
// O(n) scans on every invalidate when there are many mounted hooks.
const subscribers = new Map<string, Set<() => void>>();

function subscribe(cacheKey: string, cb: () => void) {
  let set = subscribers.get(cacheKey);
  if (!set) {
    set = new Set();
    subscribers.set(cacheKey, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subscribers.delete(cacheKey);
  };
}

function notifyPrefix(prefix: string) {
  for (const [key, set] of subscribers) {
    if (key.startsWith(prefix)) {
      for (const cb of set) cb();
    }
  }
}

export function useQuery<T>(
  key: string | (string | number | null | undefined)[],
  fetcher: () => Promise<T>,
  options: UseQueryOptions = {},
): UseQueryResult<T> {
  const { staleTime = 30_000, ttl = CacheTTL.LONG, enabled = true } = options;

  const cacheKey = buildKey(key);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isStale, setIsStale] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Track the in-flight revalidation so concurrent triggers share it.
  const inflightRef = useRef<Promise<void> | null>(null);

  const revalidate = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;
    const promise = (async () => {
      try {
        const fresh = await fetcherRef.current();
        setData(fresh);
        setIsStale(false);
        setError(null);
        await CacheService.set<CachedEntry<T>>(
          cacheKey,
          { value: fresh, fetchedAt: Date.now() },
          ttl,
        );
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
        inflightRef.current = null;
      }
    })();
    inflightRef.current = promise;
    return promise;
  }, [cacheKey, ttl]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await CacheService.get<CachedEntry<T>>(cacheKey);
      if (cancelled) return;
      if (cached && cached.value !== undefined) {
        setData(cached.value);
        setLoading(false);
        const age = Date.now() - (cached.fetchedAt ?? 0);
        if (age > staleTime) {
          setIsStale(true);
          revalidate();
        }
      } else {
        // No cache — must fetch
        await revalidate();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, staleTime, revalidate]);

  // Subscribe to invalidation events for this exact key. When fired, the
  // cache entry has already been wiped — we just need to refetch.
  useEffect(() => {
    if (!enabled) return;
    return subscribe(cacheKey, () => {
      setIsStale(true);
      revalidate();
    });
  }, [cacheKey, enabled, revalidate]);

  const refresh = useCallback(async () => {
    await revalidate();
  }, [revalidate]);

  const mutate = useCallback(
    async (updater: T | ((prev: T | null) => T)) => {
      const next = typeof updater === 'function'
        ? (updater as (prev: T | null) => T)(data)
        : updater;
      setData(next);
      await CacheService.set<CachedEntry<T>>(
        cacheKey,
        { value: next, fetchedAt: Date.now() },
        ttl,
      );
    },
    [cacheKey, data, ttl],
  );

  return { data, loading, error, isStale, refresh, mutate };
}

/**
 * Invalidate cached query entries by key prefix, drop the related axios
 * micro-cache, and notify any mounted `useQuery` hooks so they revalidate
 * in-place. Call this from mutation handlers, e.g.:
 *
 *   await bookingService.cancelBooking(id);
 *   invalidateQuery(['booking', id]);
 *   invalidateQuery(['bookings']);
 */
export async function invalidateQuery(
  key: string | (string | number | null | undefined)[],
): Promise<void> {
  const prefix = buildKey(key);
  // 1. Notify mounted hooks immediately so the UI starts revalidating
  //    even before the AsyncStorage delete resolves.
  notifyPrefix(prefix);
  // 2. Wipe persisted entries. CacheService stores under
  //    '@errandguy_cache:' + key, so pass the unprefixed form.
  await CacheService.removeByPrefix(prefix);
  // 3. Drop the in-memory axios micro-cache for related URLs.
  apiCache.invalidate(Array.isArray(key) ? String(key[0]) : key);
}
