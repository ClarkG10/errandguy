import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CacheService, CacheTTL } from '../services/cache.service';
import { apiCache } from '../services/api';
import { useNetworkStore } from '../stores/networkStore';

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
  /** Revalidate stale data when connectivity is regained (offline→online).
   *  Default true — this is the "fresh on reconnect" half of SWR. */
  refetchOnReconnect?: boolean;
  /** Revalidate stale data when the app returns to the foreground.
   *  Default true — screens left open on a backgrounded app refresh on
   *  return without a manual pull. */
  refetchOnAppFocus?: boolean;
}

export interface UseQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  isStale: boolean;
  /** Timestamp (ms) of the value currently held — from the cache-load or the
   *  last successful fetch, whichever is newer. Null until the first value
   *  arrives. Lets <SyncIndicator> render "Updated Xm ago" with zero
   *  per-screen bookkeeping. */
  updatedAt: number | null;
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
  const {
    staleTime = 30_000,
    ttl = CacheTTL.LONG,
    enabled = true,
    refetchOnReconnect = true,
    refetchOnAppFocus = true,
  } = options;

  const cacheKey = buildKey(key);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Timestamp of the last value we hold (cache load or successful fetch) so
  // background revalidation triggers can honour `staleTime` and skip a
  // refetch when the data is still fresh.
  const lastFetchedRef = useRef(0);
  // Track the in-flight revalidation so concurrent triggers share it.
  const inflightRef = useRef<Promise<void> | null>(null);
  // Guards every async setState. Flips to false on unmount so a slow
  // network response can't cause a `setState on unmounted component`
  // warning (and the wasted re-render that comes with it). This is
  // the cheaper alternative to spinning up a real AbortController on
  // every single query — we still let the in-flight axios call
  // finish so the response gets cached for the next mount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const revalidate = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;
    const promise = (async () => {
      try {
        const fresh = await fetcherRef.current();
        const now = Date.now();
        lastFetchedRef.current = now;
        if (mountedRef.current) {
          setData(fresh);
          setIsStale(false);
          setError(null);
          setUpdatedAt(now);
        }
        await CacheService.set<CachedEntry<T>>(
          cacheKey,
          { value: fresh, fetchedAt: now },
          ttl,
        );
      } catch (err) {
        if (mountedRef.current) setError(err as Error);
      } finally {
        if (mountedRef.current) setLoading(false);
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
      if (cancelled || !mountedRef.current) return;
      if (cached && cached.value !== undefined) {
        setData(cached.value);
        setLoading(false);
        lastFetchedRef.current = cached.fetchedAt ?? Date.now();
        setUpdatedAt(lastFetchedRef.current);
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

  // Background revalidation trigger — refetch only when the held value is
  // older than staleTime, so focus/reconnect events on fresh data are free.
  // The api-layer in-flight dedupe collapses simultaneous triggers into one
  // request, so multiple mounted queries reconnecting at once don't storm.
  const revalidateIfStale = useCallback(() => {
    if (!mountedRef.current) return;
    if (Date.now() - lastFetchedRef.current > staleTime) {
      setIsStale(true);
      revalidate();
    }
  }, [staleTime, revalidate]);

  // Revalidate on reconnect (offline→online transition).
  const isOffline = useNetworkStore((s) => s.isOffline);
  const prevOfflineRef = useRef(isOffline);
  useEffect(() => {
    const wasOffline = prevOfflineRef.current;
    prevOfflineRef.current = isOffline;
    if (!enabled || !refetchOnReconnect) return;
    if (wasOffline && !isOffline) revalidateIfStale();
  }, [isOffline, enabled, refetchOnReconnect, revalidateIfStale]);

  // Revalidate when the app returns to the foreground.
  useEffect(() => {
    if (!enabled || !refetchOnAppFocus) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') revalidateIfStale();
    });
    return () => sub.remove();
  }, [enabled, refetchOnAppFocus, revalidateIfStale]);

  const refresh = useCallback(async () => {
    // Pull-to-refresh is an explicit request for fresh data. The fetcher calls
    // api.get(), which would otherwise resolve from the <=8s GET micro-cache
    // and silently return stale data. Clearing the response cache (but NOT the
    // in-flight dedup map) forces this query's next GET to be a real network
    // read, independent of how the semantic key maps to the REST URL.
    apiCache.clearResponses();
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

  return { data, loading, error, isStale, updatedAt, refresh, mutate };
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
