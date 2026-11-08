import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { secureStorage } from '../utils/storage';
import { apiActivity } from '../stores/apiActivityStore';
import { network } from '../stores/networkStore';
import { classifyError, parseRetryAfter } from '../utils/classifyError';

// Teach axios's own config type about this client's per-request options so
// callers can pass them WITHOUT `as any`. These were previously bolted on via
// the local `ExtraConfig` intersection (below), which the axios method
// signatures don't accept — every call site had to cast `{ … } as any`,
// erasing type-checking of the whole config (params, headers, and the payload
// on the mutation overloads). Augmenting the interface restores that checking.
declare module 'axios' {
  interface AxiosRequestConfig {
    /** Skip in-flight dedupe + micro-cache for this request. */
    noDedupe?: boolean;
    /** Skip the micro-cache for this request. */
    noCache?: boolean;
    /** Micro-cache TTL override (ms) for this GET. */
    cacheTtlMs?: number;
    /** Suppress the global API-activity spinner for this request. */
    silent?: boolean;
    /** Max automatic retries for a failed idempotent GET (default 2). */
    retries?: number;
    /** Idempotency-Key header for a money mutation (reused across retries). */
    idempotencyKey?: string;
    /** Opt OUT of conditional-GET (ETag/If-None-Match) revalidation. */
    noConditional?: boolean;
  }
}

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
 *  2. Micro-cache — OPT-IN per request via `cacheTtlMs`. A GET that passes it
 *     resolves from the last response for that long. Without it nothing is
 *     ever served from this cache: pollers and screens read the network.
 *
 * Mutations (POST/PUT/PATCH/DELETE) bypass both and additionally invalidate
 * cache entries (and in-flight GETs) that share their URL prefix, before they
 * are sent and again once they settle, so a read issued after a write can't be
 * answered by a response that started before it.
 *
 * NOTE: for a long time none of this ran. axios 1.x binds `api.get/post/…` to
 * its inner context, so they never reached the patched `api.request` — the
 * verb helpers are re-pointed at it at the bottom of this file.
 *
 * Per-request opt-out: pass `{ noDedupe: true }` or `{ noCache: true }` in
 * the axios config (e.g., `api.get(url, { noDedupe: true })`).
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
  /** Opt OUT of conditional-GET (ETag/If-None-Match) revalidation for this
   *  request, forcing a full-body fetch. Conditional GET is otherwise automatic
   *  for any endpoint the server tags with an ETag. */
  noConditional?: boolean;
};

// No time-based cache unless the caller asks for one with `cacheTtlMs`. This
// layer never actually ran until the verb helpers were wired to it (see the
// bottom of this file), so no screen was ever checked against a default cache
// — and live pollers (tracking, chat) would have been handed stale answers.
const DEFAULT_GET_CACHE_MS = 0;
// And not even then, for now. ~36 calls pass their own `cacheTtlMs` (profile
// 30s, wallet balance 15s, an errand 4s…), written for a cache that never
// ran, so no screen was ever checked with them: a refetch after a live update
// inside that window would show the old state. Production has always read the
// network; keep it that way until each TTL is checked on a phone. Dedupe, ETag
// revalidation and the GET retry are on — those can't serve stale data.
const TIME_CACHE_ENABLED = false;
// Hard cap on cached GET responses so the micro-cache can't grow unbounded for
// the life of a session (keys vary by URL+params, so TTL alone doesn't bound
// size). Eviction only ever causes a correctness-preserving MISS (fresh
// fetch), never a stale serve.
const MAX_CACHE_ENTRIES = 100;
const inflight = new Map<string, Promise<AxiosResponse<any>>>();
const microCache = new Map<string, { ts: number; response: AxiosResponse<any> }>();

// ── Conditional-GET (ETag) store ──
// Separate from the TTL micro-cache: it retains the last ETag + full body for
// endpoints the server tags (the fat pollers — live-tracking, the runner
// feed/active errand, notification lists). The next GET for that key sends
// `If-None-Match`; a 304 lets us reuse the retained body so the server never
// ships — and the device never parses — an unchanged payload. This is the main
// lever during a realtime (Reverb) outage, when clients fall back to a tight
// REST poll of the same unchanged data. Bounded with the same write-recency
// LRU as the micro-cache; a miss only ever causes a correct full fetch.
const MAX_ETAG_ENTRIES = 60;
const etagStore = new Map<string, { etag: string; response: AxiosResponse<any> }>();
const setEtag = (key: string, etag: string, response: AxiosResponse<any>) => {
  if (etagStore.has(key)) etagStore.delete(key);
  etagStore.set(key, { etag, response });
  while (etagStore.size > MAX_ETAG_ENTRIES) {
    const oldest = etagStore.keys().next().value;
    if (oldest === undefined) break;
    etagStore.delete(oldest);
  }
};

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

/** What the login screen says after a 401 drops someone out of the app. The
 *  client can't tell why the token stopped working (expired, revoked, account
 *  suspended), so it doesn't guess — it only says what happened. */
export const SIGNED_OUT_REASON = "You've been signed out. Please sign in again.";

/** The bearer token a request was actually sent with, or null if none. */
function sentBearer(config: AxiosRequestConfig | undefined): string | null {
  const headers = config?.headers as any;
  const raw =
    typeof headers?.get === 'function'
      ? headers.get('Authorization')
      : headers?.Authorization ?? headers?.authorization;
  if (typeof raw !== 'string' || !raw.startsWith('Bearer ')) return null;
  return raw.slice('Bearer '.length) || null;
}

/**
 * Did this request carry the token the app is using RIGHT NOW?
 *
 * A response can arrive after the session it belonged to is gone — sent with
 * an old token, then a sign-out and a new sign-in happen before it lands. Its
 * 401, or the rotated token it carries, describes that OLD session; acting on
 * it would end (or overwrite the token of) the newer one. Compared against the
 * value the request interceptor reads, not the store's copy — they differ
 * during a pending biometric unlock.
 */
function carriedCurrentToken(config: AxiosRequestConfig | undefined): boolean {
  const sent = sentBearer(config);
  return !!sent && sent === secureStorage.peek('auth_token');
}

/**
 * Adopt a server-rotated access token.
 *
 * `SANCTUM_EXPIRATION` is 30 days and nothing renewed it, so every user was
 * signed out a month after their last password entry — at an arbitrary moment,
 * possibly mid-errand. The server now mints a replacement as expiry
 * approaches and returns it in `X-New-Token` (see RotateAccessToken).
 *
 * Purely additive: if the header is absent — an older API, or a token with
 * plenty of life left — nothing happens. The previous token stays valid until
 * its own expiry, so requests already in flight with it do not fail.
 *
 * Fire-and-forget: persisting the token must never delay or fail the response
 * the caller is waiting on. A failed write just means we adopt the next one.
 */
function adoptRotatedToken(response: AxiosResponse<any>): void {
  try {
    const fresh = response.headers?.['x-new-token'] ?? response.headers?.['X-New-Token'];
    if (typeof fresh !== 'string' || !fresh) return;
    // A late response from a session that has since ended must not plant its
    // replacement token over the current one.
    if (!carriedCurrentToken(response.config)) return;

    // Compare against the value the REQUEST interceptor actually reads, not the
    // store's copy — they diverge during a pending biometric unlock.
    if (secureStorage.peek('auth_token') === fresh) return;
    void secureStorage.set('auth_token', fresh);

    // Mirror into the store only when it is already holding a token. While a
    // biometric unlock is pending, `token` is deliberately withheld from state
    // (the secureStorage copy still authenticates requests) and writing one
    // back would fight that design. Lazy require avoids the api↔authStore
    // circular import.
    const { useAuthStore } = require('../stores/authStore');
    if (useAuthStore.getState().token) {
      useAuthStore.setState({ token: fresh });
    }
  } catch {
    /* store not ready, or headers absent — keep using the current token */
  }
}

/** Is someone inside the app right now (not merely holding a token behind a
 *  pending biometric unlock)? Lazy require avoids the api↔authStore cycle. */
function wasSignedIn(): boolean {
  try {
    const { useAuthStore } = require('../stores/authStore');
    return !!useAuthStore.getState().isAuthenticated;
  } catch {
    return false;
  }
}

/**
 * Tear the session down from inside the interceptor.
 *
 * Extracted so the 401 path (expired / revoked token) and the dead-account 403
 * path share exactly one implementation — they were drifting, and only one of
 * them existed.
 *
 * `wipeAccountState` is the difference that matters. A 401 is usually just an
 * expired token for an account that is about to sign back in as ITSELF, so the
 * persisted query cache and the in-progress booking draft are the user's own
 * work and are left alone. A suspended/banned/deleted account is never coming
 * back, so everything account-scoped goes — including the offline mutation
 * queue, whose unsent writes would otherwise replay under whoever signs in
 * next on the same handset.
 */
async function endSession(
  opts: { wipeAccountState?: boolean; reason?: string } = {},
): Promise<void> {
  // Runner GPS + heartbeat off first: every ping from here on carries the
  // dead token, comes back 401/403 and lands right back here. Lazy require —
  // the location store reaches this module through runner.service.
  try {
    const { stopRunnerActivity } = require('../utils/runnerSession');
    stopRunnerActivity();
  } catch {
    /* best effort — never block the teardown */
  }

  await secureStorage.remove('auth_token');

  // Hard reset the in-memory auth store so the route gate flips back to
  // /welcome immediately. Without this the user would sit on a stale
  // logged-in screen until they tried to navigate.
  // Lazy require avoids the api↔authStore circular import.
  try {
    const { useAuthStore } = require('../stores/authStore');
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      role: null,
      userIsProvisional: false,
      ...(opts.reason ? { sessionEndedReason: opts.reason } : null),
    });
  } catch {
    /* store not yet initialised — safe to ignore */
  }

  // Drop the request micro-cache + ETag store so the next sign-in doesn't
  // serve (or revalidate against) the previous user's responses.
  microCache.clear();
  etagStore.clear();
  inflight.clear();
  apiActivity.reset();

  if (opts.wipeAccountState) {
    // Lazy require: clearAccountScopedState imports apiCache from this module.
    // Never allowed to throw — a storage failure must not strand someone in a
    // half-signed-out session.
    try {
      const { clearAccountScopedState } = require('../utils/clearAccountScopedState');
      await clearAccountScopedState();
    } catch {
      /* best effort */
    }
  }
}

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
  // Also stop new reads joining a GET already in the air: it may have been
  // answered before this write landed. Dropping the entry doesn't cancel it —
  // whoever is already waiting on it still gets their answer.
  for (const k of Array.from(inflight.keys())) {
    if (k.includes(root) || k.includes(parent)) inflight.delete(k);
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
    // A request that names its own bearer keeps it: signing out a session the
    // phone has already dropped (authStore releaseDroppedSession) must reach
    // the server as THAT session, never as whoever is signed in by then.
    if (token && !sentBearer(config)) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Forward the per-attempt idempotency key for money mutations. Mutations
    // skip the GET wrapper's dedupe/cache/retry and go straight to rawRequest,
    // but the interceptor still runs on that path, so setting it here reaches
    // the POST.
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
    adoptRotatedToken(response);
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
    // axios error code (e.g. 'ECONNABORTED' on a client-side timeout). Used to
    // tell a timeout apart from being offline — both have no response.
    const axiosCode: string | undefined = error?.code;
    // Offline inference: a transport-level failure (no HTTP response at
    // all, and not an intentional cancel) flips the offline flag; any
    // response — even a 4xx/5xx — proves the server is reachable.
    //
    // A timeout is NOT offline: the server is slow, not gone. Flipping the
    // flag for one showed the offline banner over a working connection and
    // switched off the GET retry (isRetryableError fails fast while
    // offline) exactly when a retry was the right move.
    const timedOut = classifyError(0, axiosCode) === 'timeout';
    if (error?.response) {
      network.setOffline(false);
    } else if (!isCanceled && !timedOut) {
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
      // Machine-readable code from the standardized backend envelope (additive;
      // absent on legacy/not-yet-migrated responses). Powers errorCatalog copy.
      const backendCode: string | undefined = data?.code;
      const kind = classifyError(status, axiosCode, backendCode);

      // Only a 401 for the token in use now ends the session. A late 401 for
      // an older token (signed out, then someone signed in before it landed)
      // would otherwise tear down the brand-new session; a request sent with
      // no token at all has no session to end.
      if (status === 401 && carriedCurrentToken(error.config)) {
        // Say so when it drops someone out of the app — a silent bounce to
        // the login screen reads as a bug. Not said behind a pending
        // biometric unlock: they never got in.
        await endSession({ reason: wasSignedIn() ? SIGNED_OUT_REASON : undefined });
      }

      // A DEAD account (suspended / banned / deleted). EnsureUserActive returns
      // 403 with one of these codes on every authenticated route, and this
      // interceptor used to handle 401 only — so the session stayed "valid" and
      // the user was trapped inside an app where every tab failed with its own
      // generic toast and nothing ever explained why.
      //
      // Matched on the CODE, never the message: support will reword that copy.
      // A plain 403 (a permission check on one endpoint — someone else's
      // booking, a runner-only route) must NOT end the session, so this is
      // deliberately narrow.
      // Same token check as the 401 above: a late 403 for an account that has
      // already signed out must not end whoever signed in after it.
      if (
        status === 403 &&
        (backendCode === 'ACCOUNT_SUSPENDED' || backendCode === 'ACCOUNT_INACTIVE') &&
        carriedCurrentToken(error.config)
      ) {
        await endSession({
          // Unlike an expired token, this account is not coming back: purge the
          // on-device PII and — critically — the offline mutation queue, whose
          // writes can never legitimately be sent and would otherwise replay
          // under the next account to sign in on the same handset.
          wipeAccountState: true,
          reason:
            typeof data?.message === 'string' && data.message
              ? data.message
              : 'Your account is no longer active. Please contact support.',
        });
      }

      if (status === 422) {
        return Promise.reject({
          status: 422,
          message: data.message || 'Validation failed',
          errors: data.errors || {},
          code: backendCode,
          kind,
          // OTP_INVALID resolves to 422 (ErrorCode::httpStatus default) and
          // carries a top-level attempts_remaining the Verify-OTP screen reads
          // to show "N attempts left" and gate the button. Preserve it here as
          // the generic branch below already does.
          ...('attempts_remaining' in (data || {}) && { attempts_remaining: data.attempts_remaining }),
        });
      }

      if (status >= 500) {
        return Promise.reject({
          status,
          // Kept as a fallback; describeError() overrides with honest
          // server-kind copy. Retained so untouched call sites still read
          // something sensible.
          message: 'Something went wrong. Please try again later.',
          errors: {},
          code: backendCode,
          kind,
        });
      }

      // A 429 says how long to wait (meta.retry_after, or the Retry-After
      // header); keep it so the copy can say "Try again in 2 minutes" rather
      // than a vague "wait a moment".
      const retryAfter =
        status === 429
          ? parseRetryAfter(data?.meta?.retry_after ?? error.response.headers?.['retry-after'])
          : null;

      return Promise.reject({
        status,
        message: data.message || 'An error occurred',
        errors: data.errors || {},
        code: backendCode,
        kind,
        ...('attempts_remaining' in (data || {}) && { attempts_remaining: data.attempts_remaining }),
        ...(retryAfter != null && { retryAfter }),
      });
    }

    // No HTTP response: offline vs a client-side timeout are distinct cases.
    const noResponseKind = classifyError(0, axiosCode);
    return Promise.reject({
      status: 0,
      message:
        noResponseKind === 'timeout'
          ? 'The server took too long to respond. Please try again.'
          : 'Network error. Please check your connection.',
      errors: {},
      kind: noResponseKind,
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

  // Mutations bypass and invalidate related cache entries — before they go,
  // and again once they settle, so a GET that started DURING the write can't
  // be joined by a read that comes after it.
  if (!isGet) {
    invalidateRelated(config.url);
    return (rawRequest(config) as Promise<R>).finally(() => invalidateRelated(config.url));
  }

  if (!config.noCache) {
    const ttl = config.cacheTtlMs ?? DEFAULT_GET_CACHE_MS;
    const hit = microCache.get(key);
    // `ttl > 0` first: no TTL means no cached serve, even if the clock has
    // stepped backwards and made the age negative.
    if (TIME_CACHE_ENABLED && hit && ttl > 0 && Date.now() - hit.ts < ttl) {
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

  // Conditional GET: if we hold an ETag for this key and the caller hasn't
  // opted out, revalidate with If-None-Match. A 304 returns the retained body
  // (no re-download, no re-parse); a 200 carries fresh data + a new ETag.
  // Axios treats 304 as a rejection by default, so widen validateStatus to
  // accept it (preserving any caller-supplied predicate).
  const conditional = config.noConditional ? undefined : etagStore.get(key);
  if (conditional) {
    config.headers = { ...(config.headers as any), 'If-None-Match': conditional.etag };
    const prev = config.validateStatus;
    config.validateStatus = (s: number) =>
      s === 304 || (prev ? prev(s) : s >= 200 && s < 300);
  }

  const promise = getWithRetry(config, config.retries ?? DEFAULT_GET_RETRIES)
    .then((res) => {
      let effective = res;
      if (res.status === 304 && conditional) {
        // Not modified — reuse the body we already hold.
        effective = conditional.response;
      } else {
        const etag = (res.headers?.etag ?? res.headers?.ETag) as string | undefined;
        if (etag) setEtag(key, etag, res);
        else if (conditional) etagStore.delete(key); // server stopped tagging
      }
      if (!config.noCache) setCache(key, effective);
      return effective;
    })
    .finally(() => {
      // Only our own entry: a write or a sign-out may have dropped it, and a
      // newer request for the same key may be registered in its place.
      if (inflight.get(key) === promise) inflight.delete(key);
    });

  // A request carrying its own AbortSignal is not shared: aborting it would
  // fail every other caller that had joined it.
  if (!config.noDedupe && !config.signal) {
    inflight.set(key, promise as Promise<AxiosResponse<any>>);
  }
  return promise as Promise<R>;
};

// ── Route the verb helpers through the wrapper ──
// axios 1.x builds `api.get/post/…` bound to its INNER context, and they call
// that context's `request` — never the `api.request` property replaced above.
// So the dedupe, ETag and retry layer above never ran for any call in the app
// (only the interceptors did). Re-point each helper at `api.request` so it
// does. Same shape axios uses for these helpers: the config, plus method, url
// and (for the body-carrying verbs) data.
api.get = function get<T = any, R = AxiosResponse<T>, D = any>(
  url: string,
  config?: AxiosRequestConfig<D>,
): Promise<R> {
  return api.request<T, R, D>({ ...config, method: 'get', url });
};
api.delete = function del<T = any, R = AxiosResponse<T>, D = any>(
  url: string,
  config?: AxiosRequestConfig<D>,
): Promise<R> {
  return api.request<T, R, D>({ ...config, method: 'delete', url });
};
api.head = function head<T = any, R = AxiosResponse<T>, D = any>(
  url: string,
  config?: AxiosRequestConfig<D>,
): Promise<R> {
  return api.request<T, R, D>({ ...config, method: 'head', url });
};
api.options = function options<T = any, R = AxiosResponse<T>, D = any>(
  url: string,
  config?: AxiosRequestConfig<D>,
): Promise<R> {
  return api.request<T, R, D>({ ...config, method: 'options', url });
};
api.post = function post<T = any, R = AxiosResponse<T>, D = any>(
  url: string,
  data?: D,
  config?: AxiosRequestConfig<D>,
): Promise<R> {
  return api.request<T, R, D>({ ...config, method: 'post', url, data });
};
api.put = function put<T = any, R = AxiosResponse<T>, D = any>(
  url: string,
  data?: D,
  config?: AxiosRequestConfig<D>,
): Promise<R> {
  return api.request<T, R, D>({ ...config, method: 'put', url, data });
};
api.patch = function patch<T = any, R = AxiosResponse<T>, D = any>(
  url: string,
  data?: D,
  config?: AxiosRequestConfig<D>,
): Promise<R> {
  return api.request<T, R, D>({ ...config, method: 'patch', url, data });
};

// Provide a manual flush hook (e.g., on logout / pull-to-refresh)
export const apiCache = {
  clear() {
    microCache.clear();
    etagStore.clear();
    inflight.clear();
  },
  // Drop only cached responses, leaving the in-flight dedup map intact. Used by
  // pull-to-refresh so an explicit pull always reads the network, without
  // spawning a duplicate of a request already in flight. URL-agnostic on
  // purpose — the semantic query key[0] does not reliably map to the REST URL
  // (e.g. 'available-methods' vs '/payments/available-methods'), so a per-prefix
  // invalidate would silently no-op on those screens.
  clearResponses() {
    microCache.clear();
    // Also drop ETags so an explicit pull-to-refresh fetches full bodies
    // rather than revalidating into a 304 against the just-cleared cache.
    etagStore.clear();
  },
  invalidate(urlPrefix: string) {
    for (const k of Array.from(microCache.keys())) {
      if (k.includes(urlPrefix)) microCache.delete(k);
    }
    // The data is known stale, so the next read must not join a GET that
    // was already in the air before it went stale.
    for (const k of Array.from(inflight.keys())) {
      if (k.includes(urlPrefix)) inflight.delete(k);
    }
    for (const k of Array.from(etagStore.keys())) {
      if (k.includes(urlPrefix)) etagStore.delete(k);
    }
  },
};

export default api;
