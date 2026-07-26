import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { secureStorage } from '../utils/storage';
import { apiActivity } from '../stores/apiActivityStore';
import { network } from '../stores/networkStore';

const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

/**
 * ── Performance layer ──────────────────────────────────────────────────────
 * Two coalescing mechanisms applied to GET requests only:
 *
 *  1. In-flight request dedupe — if the same GET is already pending, return
 *     the same promise instead of firing a second network call. Eliminates
 *     bursts like "GET /bookings/{id} ×4" caused by overlapping useEffect
 *     re-runs and focus refetches.
 *
 *  2. Micro-cache (default 1.5s) — repeated GETs within the window resolve
 *     synchronously from the last response. Screens that mount/unmount
 *     rapidly (tab switches, navigation) no longer hammer the API.
 *
 * Mutations (POST/PUT/PATCH/DELETE) bypass both and additionally invalidate
 * cache entries that share their URL prefix to keep reads fresh after writes.
 *
 * Per-request opt-out: pass `{ noDedupe: true }` or `{ noCache: true }` in
 * the axios config (e.g., `api.get(url, { noDedupe: true } as any)`).
 */
type ExtraConfig = AxiosRequestConfig & {
  noDedupe?: boolean;
  noCache?: boolean;
  cacheTtlMs?: number;
  silent?: boolean;
  /** Max automatic retries for a failed idempotent GET (default 2 → 3 attempts).
   *  Pass 0 to disable retries for a specific request. */
  retries?: number;
  /** Idempotency-Key for a money mutation. The SAME key is reused across
   *  retries of one payment attempt so the backend collapses duplicates and
   *  never double-charges; a genuinely new attempt mints a fresh key. Set by
   *  paymentStore.beginAttempt() → forwarded as the `Idempotency-Key` header. */
  idempotencyKey?: string;
};

const DEFAULT_GET_CACHE_MS = 8000;
// Hard cap on cached GET responses so the micro-cache can't grow unbounded for
// the life of a session (keys vary by URL+params, so TTL alone doesn't bound
// size). Eviction only ever causes a correctness-preserving MISS (fresh
// fetch), never a stale serve.
const MAX_CACHE_ENTRIES = 100;
const inflight = new Map<string, Promise<AxiosResponse<any>>>();
const microCache = new Map<string, { ts: number; response: AxiosResponse<any> }>();

/**
 * ── Intelligent retry (idempotent GETs only) ──────────────────────────────
 * Transient failures — the server unreachable for a moment, or a 5xx blip —
 * are retried with exponential backoff instead of surfacing an error the user
 * has to manually retry. Mutations are NEVER retried here (not idempotent).
 *
 *   attempt 1 → immediate
 *   attempt 2 → +2s
 *   attempt 3 → +5s
 *
 * We deliberately do NOT retry: 4xx (client errors won't fix themselves),
 * cancellations, or when we already know we're offline (fail fast — the
 * OfflineBanner's health-ping drives recovery). Retry attempts also use a
 * shorter timeout so a hung server can't stack three 30s waits.
 */
const DEFAULT_GET_RETRIES = 2;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const RETRY_TIMEOUT_MS = 12000;

const isRetryableError = (err: any, config: ExtraConfig): boolean => {
  if ((config.signal as any)?.aborted) return false;
  // Don't burn backoff cycles when connectivity is already known-down.
  if (network.isOffline()) return false;
  const status = err?.status;
  // status 0 = transport/network error; >=500 = transient server error.
  // (The response interceptor normalises axios errors to `{ status, ... }`.)
  return status === 0 || (typeof status === 'number' && status >= 500);
};

async function getWithRetry(
  config: ExtraConfig,
  retries: number,
): Promise<AxiosResponse<any>> {
  let attempt = 0;
  for (;;) {
    try {
      const cfg =
        attempt === 0
          ? config
          : { ...config, timeout: Math.min(config.timeout ?? 30000, RETRY_TIMEOUT_MS) };
      return await rawRequest(cfg);
    } catch (err) {
      if (attempt >= retries || !isRetryableError(err, config)) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt] ?? 10000));
      attempt += 1;
    }
  }
}

const cacheKey = (config: AxiosRequestConfig): string => {
  const params = config.params ? JSON.stringify(config.params) : '';
  return `${(config.method ?? 'get').toLowerCase()}:${config.url ?? ''}:${params}`;
};

const invalidateRelated = (url?: string) => {
  if (!url) return;
  // POST /runner/location is append-only GPS telemetry (throttled ~1/5s while
  // the runner is moving) — it is NOT a resource mutation. Running the generic
  // prefix invalidation on it means its parent prefix `/runner` matches — and
  // wipes — every cached runner-dashboard GET a few times a minute, defeating
  // the micro-cache for the whole runner surface. Exempt it explicitly; the
  // parent-prefix fallback below is kept intact for real mutations (e.g.
  // POST /bookings/{id}/cancel must still invalidate the /bookings list cache).
  if (url.includes('/runner/location')) return;
  // Drop any cache entry whose URL starts with the same resource prefix
  // (e.g., POST /bookings/{id}/cancel invalidates GET /bookings/{id} and /bookings).
  const root = url.split('?')[0].split('/').slice(0, 3).join('/'); // /bookings/{id}
  const parent = url.split('?')[0].split('/').slice(0, 2).join('/'); // /bookings
  for (const k of Array.from(microCache.keys())) {
    if (k.includes(root) || k.includes(parent)) microCache.delete(k);
  }
};

const setCache = (key: string, response: AxiosResponse<any>) => {
  // Write-recency LRU. Re-insert to move an existing key to the Map's tail,
  // then evict from the head once past the cap. NOTE: recency is refreshed
  // only on a network WRITE, so a long-TTL entry served purely from cache
  // reads can be evicted mid-TTL by write churn — that only triggers a correct
  // fresh refetch, never a stale serve (the TTL read gate is unchanged). We do
  // NOT restamp `ts` on read: doing so would defeat the TTL and serve stale.
  if (microCache.has(key)) microCache.delete(key);
  microCache.set(key, { ts: Date.now(), response });
  while (microCache.size > MAX_CACHE_ENTRIES) {
    const oldest = microCache.keys().next().value;
    if (oldest === undefined) break;
    microCache.delete(oldest);
  }
};

// ── Request logging ──
api.interceptors.request.use(
  async (config) => {
    // Hot-path: peek the in-memory token cache first to avoid an async
    // SecureStore round-trip on every request. Falls back to the async
    // read only on cold start (before authStore.loadFromStorage has
    // populated the cache).
    let token = secureStorage.peek('auth_token');
    if (token === undefined) {
      token = await secureStorage.get('auth_token');
    }
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Forward the per-attempt idempotency key for money mutations. Mutations
    // flow straight to rawRequest (they bypass the GET wrapper), but the
    // interceptor still runs on that path, so setting it here reaches the POST.
    const idem = (config as ExtraConfig).idempotencyKey;
    if (idem) {
      config.headers['Idempotency-Key'] = idem;
    }
    // Bump the global activity counter so the top progress bar appears
    // for any in-flight network request. Cache hits skip this entirely
    // (handled inside the request wrapper below). Background pollers,
    // GPS pings, and unread-count refreshes pass `silent: true` so they
    // don't pin the bar permanently.
    if (!(config as ExtraConfig).silent) {
      apiActivity.start();
    }
    // Per-request logging removed in favour of the on-screen activity
    // bar. The previous JSON.stringify on every call added measurable
    // overhead on the RN bridge during burst traffic and produced log
    // noise that hid real failures.
    return config;
  },
  (error) => {
    if (!(error?.config as ExtraConfig | undefined)?.silent) {
      apiActivity.done();
    }
    return Promise.reject(error);
  },
);

// ── Response logging + error handling ──
api.interceptors.response.use(
  (response) => {
    if (!(response.config as ExtraConfig).silent) {
      apiActivity.done();
    }
    // Any successful response means we're reachable — clear the offline
    // flag. The store no-ops when unchanged, so this is free on the
    // happy path.
    network.setOffline(false);
    return response;
  },
  async (error) => {
    if (!(error?.config as ExtraConfig | undefined)?.silent) {
      apiActivity.done();
    }
    const isCanceled =
      error?.name === 'CanceledError' ||
      error?.code === 'ERR_CANCELED' ||
      error?.message === 'canceled';
    // Offline inference: a transport-level failure (no HTTP response at
    // all, and not an intentional cancel) flips the offline flag; any
    // response — even a 4xx/5xx — proves the server is reachable.
    if (error?.response) {
      network.setOffline(false);
    } else if (!isCanceled) {
      network.setOffline(true);
    }
    const isSilent = !!(error?.config as ExtraConfig | undefined)?.silent;
    if (__DEV__ && !isSilent && !isCanceled) {
      if (error.response) {
        // Silence expected 429s on the runner location endpoint. The
        // server throttles GPS pushes to 1/5s per runner; the mobile
        // GPS watcher already debounces to match, but a transient
        // burst (mode change, app foreground, multiple watchers
        // resuming together) can briefly outpace the throttle. These
        // are NOT errors \u2014 they are the throttle working as designed
        // \u2014 and logging them as red ERROR makes real failures hide
        // in noise.
        const url: string = error.config?.url ?? '';
        const status = error.response.status;
        // Quiet logs we don't want to see as red ERRORs in dev:
        //  • 429 on /runner/location — server-side GPS throttle, expected.
        //  • 422 anywhere — validation rejections handled by the UI as
        //    toasts/inline errors. Logging them as ERROR adds noise and
        //    hides real failures. The status + message still flow to
        //    the rejection below.
        const isExpectedThrottle =
          status === 429 && url.includes('/runner/location');
        const isClientValidation = status === 422;
        if (!isExpectedThrottle && !isClientValidation) {
          // Lazy-serialize the response body only when actually printed.
          // Calling `JSON.stringify` eagerly inside the template string
          // ran on EVERY error including silent retries, which on the
          // RN bridge during burst traffic was a measurable perf cost.
          // `console.error` will stringify on demand when emitting.
          console.error(
            `❌ ${status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
            error.response.data,
          );
        }
      } else {
        console.error(`❌ NETWORK ERROR ${error.config?.url}`, error.message);
      }
    }

    if (error.response) {
      const { status, data } = error.response;

      if (status === 401) {
        await secureStorage.remove('auth_token');
        // Hard reset the in-memory auth store so the route gate flips
        // back to /welcome immediately. Without this the user would sit
        // on a stale logged-in screen until they tried to navigate.
        // Lazy require avoids the api↔authStore circular import.
        try {
          const { useAuthStore } = require('../stores/authStore');
          useAuthStore.setState({
            user: null,
            token: null,
            isAuthenticated: false,
            role: null,
          });
        } catch {
          /* store not yet initialised — safe to ignore */
        }
        // Also drop the request micro-cache so the next sign-in doesn't
        // serve the previous user's cached responses.
        microCache.clear();
        inflight.clear();
        apiActivity.reset();
      }

      if (status === 422) {
        return Promise.reject({
          status: 422,
          message: data.message || 'Validation failed',
          errors: data.errors || {},
        });
      }

      if (status >= 500) {
        return Promise.reject({
          status,
          message: 'Something went wrong. Please try again later.',
          errors: {},
        });
      }

      return Promise.reject({
        status,
        message: data.message || 'An error occurred',
        errors: data.errors || {},
        ...('attempts_remaining' in (data || {}) && { attempts_remaining: data.attempts_remaining }),
      });
    }

    return Promise.reject({
      status: 0,
      message: 'Network error. Please check your connection.',
      errors: {},
    });
  },
);

// ── GET dedupe + micro-cache wrapper ──
const rawRequest = api.request.bind(api);
api.request = function patchedRequest<T = any, R = AxiosResponse<T>, D = any>(
  config: ExtraConfig & { data?: D },
): Promise<R> {
  const method = (config.method ?? 'get').toString().toLowerCase();
  const isGet = method === 'get';
  const key = cacheKey(config);

  // Mutations bypass and invalidate related cache entries
  if (!isGet) {
    invalidateRelated(config.url);
    return rawRequest(config) as Promise<R>;
  }

  if (!config.noCache) {
    const ttl = config.cacheTtlMs ?? DEFAULT_GET_CACHE_MS;
    const hit = microCache.get(key);
    if (hit && Date.now() - hit.ts < ttl) {
      // Cache hit: never went through the request interceptor, so the
      // activity bar was not bumped — nothing to balance here. Resolve
      // synchronously to keep `await api.get(...)` fast.
      return Promise.resolve(hit.response as unknown as R);
    }
  }

  if (!config.noDedupe) {
    const pending = inflight.get(key);
    if (pending) return pending as unknown as Promise<R>;
  }

  const promise = getWithRetry(config, config.retries ?? DEFAULT_GET_RETRIES)
    .then((res) => {
      if (!config.noCache) setCache(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(key);
    });

  if (!config.noDedupe) inflight.set(key, promise as Promise<AxiosResponse<any>>);
  return promise as Promise<R>;
};

// Provide a manual flush hook (e.g., on logout / pull-to-refresh)
export const apiCache = {
  clear() {
    microCache.clear();
    inflight.clear();
  },
  // Drop only cached responses, leaving the in-flight dedup map intact. Used by
  // pull-to-refresh so an explicit pull always reads the network, without
  // spawning a duplicate of a request already in flight. URL-agnostic on
  // purpose — the semantic query key[0] does not reliably map to the REST URL
  // (e.g. 'payment-methods' vs '/payments/methods'), so a per-prefix
  // invalidate would silently no-op on those screens.
  clearResponses() {
    microCache.clear();
  },
  invalidate(urlPrefix: string) {
    for (const k of Array.from(microCache.keys())) {
      if (k.includes(urlPrefix)) microCache.delete(k);
    }
  },
};

export default api;
