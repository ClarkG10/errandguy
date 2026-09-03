import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import api from './api';
import { CacheService, CacheTTL } from './cache.service';
import { configService } from './config.service';
import { bookingService } from './booking.service';
import { paymentService } from './payment.service';
import { runnerService } from './runner.service';
import { supportService } from './support.service';
import { notificationService } from './notification.service';
import { userService, type CustomerHomeAggregate } from './user.service';
import { chatService } from './chat.service';
import { useChatStore } from '../stores/chatStore';
import { useBookingStore } from '../stores/bookingStore';
import { runPool } from '../utils/asyncPool';
import { parseActiveBookings } from '../utils/activeBookings';
import type { Booking, Conversation, Message } from '../types';

// Mirrors the AsyncStorage key used by the trusted-contacts screen
// (which doesn't go through useQuery — see trusted-contacts/index.tsx).
const TRUSTED_CONTACTS_LEGACY_KEY = '@trusted_contacts_cache';

/**
 * Build the same cache key shape as `useQuery` does.
 *
 * `useQuery` stores entries under `META_PREFIX + joined-key` (see
 * `src/hooks/useQuery.ts`). We mirror that shape here so the value
 * we write is the very entry the hook will pick up on first render.
 */
const META_PREFIX = 'q:';
const buildKey = (key: (string | number)[]) =>
  META_PREFIX + key.filter((p) => p != null).join(':');

const CORE_IMAGE_ASSETS = [
  require('../../assets/logo-new.png'),
  require('../../assets/mascot-home.png'),
  require('../../assets/wordmark-lockup.png'),
  require('../../assets/wordmark-stacked.png'),
  require('../../assets/ONBOARDING-1.png'),
  require('../../assets/ONBOARDING-2.png'),
  require('../../assets/ONBOARDING-3.png'),
  require('../../assets/location-permission.png'),
  require('../../assets/contact-permission.png'),
  require('../../assets/delivery.png'),
  require('../../assets/grocery-shopping.png'),
  require('../../assets/food-pickup.png'),
  require('../../assets/document-delivery.png'),
  require('../../assets/laundry.png'),
  require('../../assets/transportation.png'),
  require('../../assets/bills-payment.png'),
  require('../../assets/queue-or-line.png'),
  require('../../assets/purchase-and-deliver.png'),
  require('../../assets/custom-errand.png'),
] as const;

let coreImagePreloadPromise: Promise<void> | null = null;

interface CachedEntry<T> {
  value: T;
  fetchedAt: number;
}

const seed = async <T>(
  keyParts: (string | number)[],
  fetcher: () => Promise<T>,
  ttl: number,
) => {
  try {
    const value = await fetcher();
    await CacheService.set<CachedEntry<T>>(
      buildKey(keyParts),
      { value, fetchedAt: Date.now() },
      ttl,
    );
  } catch {
    // Preload is best-effort. A failure here is silent — the screen
    // that actually needs the data will fetch it normally.
  }
};

/**
 * Warm a single useQuery cache entry ON DEMAND — e.g. when a row is tapped,
 * just before navigating to the screen that reads it. Writes the exact
 * key/shape `useQuery` expects, so the destination paints from cache on its
 * first frame (then revalidates in the background, deduped by the api layer).
 * Best-effort + silent; the destination fetches normally if this misses.
 *
 *   onPress={() => {
 *     prefetchQuery(['runner','errand','byId', id],
 *       async () => (await runnerService.getErrand(id)).data?.data ?? null,
 *       CacheTTL.SHORT);
 *     router.push(`/(runner)/errand/${id}`);
 *   }}
 *
 * The fetcher MUST return the same value shape the screen's useQuery fetcher
 * returns (i.e. the unwrapped `.data.data`), not the raw axios response.
 */
export const prefetchQuery = seed;

/**
 * Warm the runner errand-detail cache before navigating to
 * (runner)/errand/[id], so the screen paints from cache instead of a skeleton.
 * Generalizes the prefetch that previously existed ONLY on NegotiateOfferCard
 * to the genuinely-cold recent-errand rows (home) and History rows. Best-effort
 * + silent (fire-and-forget); the destination revalidates regardless, so there
 * is no correctness risk. Writes the exact key/shape errand/[id].tsx reads. (P24)
 */
export function prefetchRunnerErrand(id: string): void {
  if (!id) return;
  void seed(
    ['runner', 'errand', 'byId', id],
    async () => (await runnerService.getErrand(id)).data?.data ?? null,
    CacheTTL.SHORT,
  );
}

/**
 * Warm the customer tracking screen on a tap, BEFORE navigating to
 * tracking/[id], so it paints instantly instead of flashing TrackingSkeleton.
 * TrackingScreen only fast-paints when the tapped booking already equals
 * bookingStore.activeBooking; list rows, the booking-detail sheet, and
 * notification taps don't satisfy that, so:
 *  1. Seed bookingStore.activeBooking with the full Booking the caller holds
 *     (when available) → instant first paint. TrackingScreen's own fetch
 *     re-seeds on fresh data, so a slightly stale list-shaped row self-heals.
 *  2. Fire getBooking(id) (4s micro-cache + in-flight dedupe) so the screen's
 *     mount fetch coalesces onto this already-warm request.
 * Pass the full Booking when you have it (sheet / list row); pass just the id
 * for a push-notification tap (warms the fetch only). Best-effort + silent. (P2)
 */
export function warmTracking(bookingOrId: Booking | string): void {
  const id = typeof bookingOrId === 'string' ? bookingOrId : bookingOrId?.id;
  if (!id) return;
  if (typeof bookingOrId !== 'string') {
    useBookingStore.getState().setActiveBooking(bookingOrId);
  }
  void bookingService.getBooking(id).catch(() => {});
}

/**
 * Warm the Promos and Referral screens. Both are one tap from the Profile tab,
 * and Promos is also a promo-push deep-link target — yet neither had a warm
 * entry, so the highest-intent entry always showed a spinner. Writes the exact
 * useQuery keys/shapes those screens read (['promos', userId] → Promo[];
 * ['user','referral', userId] → ReferralInfo). Deliberately kept OUT of the
 * first-wave auth warm-up. Best-effort + silent. (P32)
 */
export function prefetchPromos(userId: string): void {
  void seed(
    ['promos', userId],
    async () => ((await configService.getPromos()).data?.data ?? []) as unknown[],
    CacheTTL.MEDIUM,
  );
}

export function prefetchReferral(userId: string): void {
  // No `?? null` fallback: if the payload is missing, seed writes `undefined`,
  // which useQuery treats as a cache miss and fetches normally (rather than
  // pinning an empty referral card until revalidate).
  void seed(
    ['user', 'referral', userId],
    async () => (await userService.getReferral()).data?.data,
    CacheTTL.MEDIUM,
  );
}

/**
 * Warm the Support inbox on a tap from either Help screen.
 *
 * The only two ways in are `(customer)/help` and `(runner)/settings/help`, and
 * neither warmed anything — so the one screen a user opens BECAUSE something
 * is already wrong greeted them with a spinner. Params and shape mirror the
 * screen's own fetcher exactly.
 */
export function prefetchSupportTickets(userId: string): void {
  void seed(
    ['support', 'tickets', userId],
    async () => ((await supportService.getTickets()).data?.data ?? []) as unknown[],
    CacheTTL.MEDIUM,
  );
}

/**
 * Warm the Demand screen's heatmap on a tap from the runner Home quick action.
 *
 * The runner-home aggregate already seeds `['runner','peak-hours',30]`, so the
 * peak-hours nudge on this screen paints from cache — but the 14-day heatmap
 * GRID beside it was never warmed, so half the screen always spun. The day
 * count is part of the cache key, so it has to match the screen's 14 exactly.
 */
export function prefetchDemand(): void {
  void seed(
    ['runner', 'heatmap', DEMAND_HEATMAP_DAYS],
    async () => (await runnerService.getHeatmap(DEMAND_HEATMAP_DAYS)).data?.data,
    CacheTTL.LONG,
  );
}

/** Days of history the Demand heatmap requests — part of its cache key. */
const DEMAND_HEATMAP_DAYS = 14;

/**
 * Rows in the payout screen's activity preview.
 *
 * Owned HERE and imported by the screen, rather than duplicated, because the
 * page size is part of what the seeded value must correspond to: a silent
 * divergence would leave the prefetch warming a shape the screen never uses —
 * the exact dead-prefetch failure this pass was auditing for.
 */
export const PAYOUT_ACTIVITY_PREVIEW = 6;

/**
 * Warm the payout screen's recent wallet activity on a tap from Earnings.
 *
 * The payout list itself is warmed at boot, but the activity preview under it
 * was not — so a money screen half-painted. `perPage` must match the screen's
 * own page size, since the fetcher's params are what the seeded value has to
 * correspond to.
 */
export function prefetchPayoutActivity(userId: string): void {
  void seed(
    ['runner', 'wallet', 'activity', userId],
    async () =>
      ((
        await paymentService.getWalletTransactions({
          page: 1,
          per_page: PAYOUT_ACTIVITY_PREVIEW,
        })
      ).data?.data ?? []) as unknown[],
    CacheTTL.MEDIUM,
  );
}

export function preloadCoreImages() {
  if (!coreImagePreloadPromise) {
    coreImagePreloadPromise = Asset.loadAsync([...CORE_IMAGE_ASSETS])
      .then(() => {})
      .catch(() => {});
  }

  return coreImagePreloadPromise;
}

/**
 * Warm a SINGLE chat thread's messages into the store + persistent cache on
 * INTENT — e.g. TrackingScreen mount for the errand being tracked (the thread
 * the user is far and away most likely to open). Replaces the old blanket
 * "top-4 threads on every cold start" warm, which fired up to 4 speculative
 * requests per role for users who never opened chat AND still missed the
 * tracked thread whenever it wasn't in the top 4.
 *
 * Chat messages live under CacheService('chat:messages:${id}') + chatStore —
 * NOT a useQuery/seed key. Guarded (before AND after the await) so it never
 * clobbers a thread the user already has open/streamed. Best-effort. (P25)
 */
export async function prefetchChatMessages(bookingId: string): Promise<void> {
  if (!bookingId) return;
  if (useChatStore.getState().messages[bookingId]?.length) return;
  try {
    const response = await chatService.getMessages(bookingId, { limit: 50 });
    const messages = (response.data?.data ?? []) as Message[];
    if (useChatStore.getState().messages[bookingId]?.length) return;
    useChatStore.getState().setMessages(bookingId, messages);
    await CacheService.set<Message[]>(`chat:messages:${bookingId}`, messages, CacheTTL.LONG);
  } catch {
    // Best-effort: opening the thread will fetch normally.
  }
}

/**
 * Cold-start warm-up for the chat inbox: seed the conversations LIST only
 * (above-the-fold on the chat tab, one cheap request). Per-thread message
 * history is no longer fetched here — it moved to prefetchChatMessages() on
 * intent (tracked thread on TrackingScreen mount). (P25)
 */
const preloadConversationsList = async (userId: string) => {
  const response = await chatService.getConversations();
  const conversations = (response.data?.data ?? []) as Conversation[];
  await CacheService.set<CachedEntry<Conversation[]>>(
    buildKey(['chat', 'conversations', userId]),
    { value: conversations, fetchedAt: Date.now() },
    CacheTTL.MEDIUM,
  );
};

/**
 * The ORIGINAL per-endpoint above-the-fold Home seeds — one request each.
 *
 * These are no longer the first choice (the /customer/home aggregate below
 * gets the same data in a single round trip), but they are kept EXACTLY as
 * they were as the fallback path: if the aggregate is unavailable — an older
 * server, a 403/404, a partial payload — warm-up degrades to precisely the
 * behaviour that shipped before it existed. Thunks, so the pool decides when
 * each fires.
 */
const customerAboveFoldSeeds = (userId: string): Array<() => Promise<unknown>> => [
  () =>
    seed(
      ['errand-types'],
      async () => {
        const r = await configService.getErrandTypes();
        return r.data?.data ?? [];
      },
      CacheTTL.STATIC,
    ),
  () =>
    seed(
      ['booking', 'active', userId],
      async () => {
        const r = await bookingService.getActiveBooking();
        return r.data?.data ?? r.data ?? null;
      },
      CacheTTL.SHORT,
    ),
  () =>
    seed(
      ['bookings', 'recent', userId],
      async () => {
        const r = await bookingService.getBookings({ per_page: 5 });
        return r.data?.data ?? r.data ?? [];
      },
      CacheTTL.LONG,
    ),
  () =>
    seed(
      ['wallet', 'balance', userId],
      async () => {
        const r = await paymentService.getWalletBalance();
        // Must match the wallet screen's useQuery fetcher, which returns the
        // NUMBER (`data.balance`) — not the whole balance object. Seeding the
        // object here poisoned the shared cache key, so the hero briefly
        // rendered "₱[object Object]" on cold start until the live fetch ran.
        return r.data?.data?.balance ?? r.data?.balance ?? 0;
      },
      CacheTTL.MEDIUM,
    ),
];

/**
 * Structural guard on the aggregate payload.
 *
 * Seeding is a WRITE into caches the screens read on their first frame, so a
 * half-formed payload is worse than no payload: `active_booking` missing would
 * pin "no active errand" over a live one for the whole freshness window. We
 * therefore require every section to be present and of the right kind, and
 * fall back to the individual endpoints if anything is off. `active_booking`
 * and `referral` are nullable, so they're checked for PRESENCE, not truth.
 */
const isUsableHomeAggregate = (payload: unknown): payload is CustomerHomeAggregate => {
  if (!payload || typeof payload !== 'object') return false;
  const h = payload as Partial<CustomerHomeAggregate>;
  return (
    Array.isArray(h.errand_types) &&
    Array.isArray(h.recent_bookings) &&
    Array.isArray(h.promos) &&
    typeof h.wallet_balance === 'number' &&
    Number.isFinite(h.wallet_balance) &&
    'active_booking' in payload &&
    'referral' in payload
  );
};

/**
 * Seed every above-the-fold Home cache from ONE request (P-M10).
 *
 * Home used to cost five separate authenticated GETs at warm-up (and six more
 * on the screen itself), each paying a full framework boot + Sanctum auth on
 * Forge — two sequential waves through the 4-wide pool on PH mobile RTTs.
 * GET /customer/home returns all six sections at once, so warm-up is a single
 * round trip and the rewards band (promos / referral / wallet), which was
 * never warmed above the fold at all, now paints from cache for free.
 *
 * The cache keys, value shapes and TTLs written here are IDENTICAL to the
 * per-endpoint seeds above — the screens' useQuery keys are untouched and the
 * individual endpoints remain their revalidation paths. Any failure (network,
 * unavailable endpoint, unusable payload) transparently falls back to those
 * per-endpoint seeds, so this can only ever be faster, never less warm.
 */
async function seedCustomerHome(userId: string): Promise<void> {
  try {
    const response = await userService.getCustomerHome();
    const home = response.data?.data;
    if (!isUsableHomeAggregate(home)) throw new Error('unusable home aggregate');

    // One timestamp for the whole snapshot — it IS one read.
    const fetchedAt = Date.now();
    const write = <T,>(keyParts: (string | number)[], value: T, ttl: number) =>
      CacheService.set<CachedEntry<T>>(buildKey(keyParts), { value, fetchedAt }, ttl);

    await Promise.all([
      write(['errand-types'], home.errand_types, CacheTTL.STATIC),
      write(['booking', 'active', userId], home.active_booking ?? null, CacheTTL.SHORT),
      // The ARRAY of live errands, alongside the singular above.
      //
      // Home splits these two on purpose (the singular paints card #1 from the
      // snapshot instantly while the list resolves), but the list key was never
      // seeded — so on every cold start it was a genuine extra authenticated
      // GET, on the most-hit surface in the app: the customer Home tab, the
      // Profile tab and (customer)/_layout all read this key, and the layout
      // uses it to pick which booking the realtime channel follows.
      //
      // Parsed with the SAME helper the screen's own fetcher uses, so the
      // seeded value cannot drift in shape from what it would have fetched —
      // the parity this whole snapshot depends on.
      // Conditional for the same reason `referral` below is: an older API build
      // omits the section, and seeding an empty array would pin "no active
      // errand" over a live one for the whole freshness window. Absent → leave
      // the key a miss and let the screen fetch, i.e. exactly today's
      // behaviour, never worse.
      ...(Array.isArray(home.active_bookings)
        ? [
            write(
              ['bookings', 'active-list', userId],
              parseActiveBookings({
                active_bookings: home.active_bookings,
                data: home.active_booking ?? null,
              }),
              CacheTTL.SHORT,
            ),
          ]
        : []),
      write(['bookings', 'recent', userId], home.recent_bookings, CacheTTL.LONG),
      // The NUMBER, matching the wallet screen's fetcher (see the seed above).
      write(['wallet', 'balance', userId], home.wallet_balance, CacheTTL.MEDIUM),
      write(['promos', userId], home.promos, CacheTTL.MEDIUM),
      // Referral is nullable on the wire but the screen caches an object; a
      // null would pin an empty referral card, so leave the key a miss and let
      // the screen fetch it normally (same reasoning as prefetchReferral).
      ...(home.referral
        ? [write(['user', 'referral', userId], home.referral, CacheTTL.MEDIUM)]
        : []),
    ]);
  } catch {
    // Best-effort, exactly like every other warm-up path: degrade to the
    // pre-aggregate per-endpoint seeds rather than leaving Home cold.
    await runPool(customerAboveFoldSeeds(userId));
  }
}

/**
 * Preload critical queries the user is about to need.
 *
 * Called once after a successful login / register,
 * and once at app open if a session was restored. The goal is that
 * by the time the user lands on Home, every above-the-fold piece
 * of data is already sitting in AsyncStorage under the same cache
 * key the screen's `useQuery` will read — so the screen renders
 * with real data on the very first frame, no skeleton.
 *
 * All requests fire in parallel, are silent (no top progress bar),
 * and rely on the axios layer's in-flight dedupe so they coalesce
 * with any duplicate fetch the screen kicks off in race.
 */
export async function preloadCustomerEssentials(userId: string) {
  // Above-the-fold Home data — the ONLY set the interactive login / register
  // paths await before raising the success curtain, so the
  // "Logging in…" button releases as soon as Home can paint instead of blocking
  // on the ENTIRE warm-up pool below (wallet history, notifications, chat
  // threads, activity, addresses, payment methods, trusted contacts). Entries
  // are thunks so the pool — not JS — decides when each fires. (P3)
  //
  // What used to be five separate requests here is now ONE — seedCustomerHome
  // fans GET /customer/home out into the same five cache keys (plus promos and
  // referral, free in the same payload) and falls back to those five requests
  // if the aggregate is unavailable. (P-M10)
  const aboveFold: Array<() => Promise<unknown>> = [
    () => preloadCoreImages(),
    () => seedCustomerHome(userId),
  ];

  // Below-the-fold — warmed in the BACKGROUND once Home is already interactive.
  // runPool swallows per-task rejections internally, so leaving this un-awaited
  // can't produce an unhandled rejection (preloadConversationsList has no
  // try/catch of its own). Cache keys are unchanged, so the deferred fetches
  // still land under the same useQuery keys each screen reads. (P3)
  const belowFold: Array<() => Promise<unknown>> = [
    () =>
      seed(
        // Default (unfiltered) transactions list — matches the wallet screen's
        // ['wallet','transactions',userId, txFilter ?? 'all'] key so it paints
        // its history instantly instead of just the balance.
        ['wallet', 'transactions', userId, 'all'],
        async () => {
          const r = await paymentService.getWalletTransactions();
          return (r.data?.data ?? r.data ?? []) as any[];
        },
        CacheTTL.MEDIUM,
      ),
    // Prime the unread badge — a REQUEST, not a query-cache seed.
    //
    // The tab badge doesn't go through useQuery at all: useRealtimeNotifications
    // calls getUnreadCount() straight into the store and keeps it live over
    // Reverb. So the CacheService key this used to write was read by nothing.
    // What actually made the badge paint immediately was the side effect —
    // getUnreadCount() is an `api.get` with a 15s micro-cache, so warming it
    // here means the hook's own call on mount coalesces onto this one.
    // Keeping the request and dropping the dead write states that plainly.
    () => notificationService.getUnreadCount().then(() => undefined).catch(() => undefined),
    () =>
      seed(
        ['notifications', userId],
        async () => {
          const r = await notificationService.getNotifications({ page: 1, per_page: 20 });
          return (r.data?.data ?? []) as any[];
        },
        CacheTTL.MEDIUM,
      ),
    () =>
      seed(
        ['user', 'addresses', userId],
        async () => {
          const r = await userService.getAddresses();
          return (r.data?.data ?? r.data ?? []) as any[];
        },
        CacheTTL.LONG,
      ),
    () =>
      seed(
        ['payment-methods', userId],
        async () => {
          const r = await paymentService.getPaymentMethods();
          return (r.data?.data ?? r.data ?? []) as any[];
        },
        CacheTTL.MEDIUM,
      ),
    () => preloadConversationsList(userId),
    () =>
      seed(
        ['bookings', 'activity', 'all', userId],
        async () => {
          const r = await bookingService.getBookings({ page: 1, per_page: 15 });
          return (r.data?.data ?? r.data ?? []) as any[];
        },
        CacheTTL.LONG,
      ),
    // Trusted contacts uses a legacy AsyncStorage cache (not useQuery),
    // so write directly to its key shape so the screen paints instantly.
    () =>
      (async () => {
        try {
          const r = await userService.getTrustedContacts();
          const list = (r.data?.data ?? r.data ?? []) as any[];
          const sorted = Array.isArray(list)
            ? [...list].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
            : [];
          await AsyncStorage.setItem(TRUSTED_CONTACTS_LEGACY_KEY, JSON.stringify(sorted));
        } catch {
          // Best-effort; the screen falls back to its own fetch.
        }
      })(),
  ];

  // Await ONLY the above-fold set (what Home needs to paint); fire the rest
  // fire-and-forget so the auth transition isn't held on background warm-up. (P3)
  await runPool(aboveFold);
  void runPool(belowFold);
}

/**
 * GET /runner/home — every above-the-fold runner-dashboard section in ONE
 * authenticated round trip (RunnerHomeController).
 *
 * Each field is byte-identical to the `data` of the endpoint it stands in for:
 *   profile           ← GET /runner/profile
 *   earnings_today    ← GET /runner/earnings?period=today
 *   earnings_week     ← GET /runner/earnings?period=this_week
 *   recent_errands    ← GET /runner/errands/history?per_page=3
 *   available_errands ← GET /runner/errand/available   ([] when offline)
 *   current_errand    ← GET /runner/errand/current
 *   peak_hours        ← GET /runner/peak-hours?days=30
 *
 * That parity is the whole point: seedRunnerHome writes these straight into
 * the per-section useQuery cache keys, so any drift would silently poison
 * them. The individual endpoints stay as each screen's revalidation path.
 *
 * The section values are deliberately `unknown` where this module has no
 * business asserting a shape (the profile / earnings objects are typed by the
 * screens that read them); what matters here is the KEY and the TTL.
 */
export interface RunnerHomeAggregate {
  profile: unknown;
  earnings_today: unknown;
  earnings_week: unknown;
  recent_errands: Booking[];
  available_errands: Booking[];
  current_errand: Booking | null;
  peak_hours: { days: number; grid: number[][] } | null;
}

/**
 * The one request seedRunnerHome makes.
 *
 * This BELONGS on runnerService, beside the calls it replaces — exactly where
 * userService.getCustomerHome() sits for the customer aggregate. runner.service.ts
 * is owned by another workstream this pass, so the call lives here for now:
 * when `runnerService.getHome()` lands, swap this body for it and nothing else
 * changes. Silent so cold-start warm-up never flashes the top progress bar,
 * and micro-cached briefly so warm-up and an in-race screen fetch coalesce
 * rather than paying the round trip twice (mirrors getCustomerHome).
 */
const getRunnerHome = () =>
  api.get<{ data: RunnerHomeAggregate }>('/runner/home', {
    cacheTtlMs: 30_000,
    silent: true,
  });

/**
 * The ORIGINAL per-endpoint above-the-fold runner seeds — one request each.
 *
 * Superseded by the /runner/home aggregate below, but kept EXACTLY as they
 * were as its fallback path: an older server, a 403/404 or a partial payload
 * degrades warm-up to precisely the behaviour that shipped before the
 * aggregate existed. Thunks, so the pool decides when each fires.
 */
const runnerAboveFoldSeeds = (userId: string): Array<() => Promise<unknown>> => [
  () =>
    seed(
      ['runner', 'profile', userId],
      async () => {
        const r = await runnerService.getRunnerProfile();
        return r.data?.data ?? r.data ?? null;
      },
      CacheTTL.LONG,
    ),
  () =>
    seed(
      ['runner', 'earnings', 'today', userId],
      async () => {
        const r = await runnerService.getEarnings('today');
        return r.data?.data ?? r.data ?? null;
      },
      CacheTTL.MEDIUM,
    ),
  () =>
    seed(
      ['runner', 'earnings', 'week', userId],
      async () => {
        const r = await runnerService.getEarnings('week');
        return r.data?.data ?? r.data ?? null;
      },
      CacheTTL.MEDIUM,
    ),
  () =>
    seed(
      ['runner', 'errands', 'recent', userId],
      async () => {
        const r = await runnerService.getErrandHistory({ page: 1, per_page: 3 });
        return r.data?.data ?? r.data ?? [];
      },
      CacheTTL.LONG,
    ),
  () =>
    seed(
      ['runner', 'errand', 'available', userId],
      async () => {
        const r = await runnerService.getAvailableErrands();
        return r.data?.data ?? r.data ?? [];
      },
      CacheTTL.SHORT,
    ),
  () =>
    seed(
      ['runner', 'errand', 'current', userId],
      async () => {
        const r = await runnerService.getCurrentErrand();
        return r.data?.data ?? r.data ?? null;
      },
      CacheTTL.SHORT,
    ),
];

/**
 * Structural guard on the runner aggregate payload.
 *
 * Same contract as isUsableHomeAggregate: seeding is a WRITE into the caches
 * the dashboard paints from on its first frame, so a half-formed payload is
 * worse than no payload (a missing `current_errand` would pin "no errand" over
 * a live one for the whole freshness window). Every section must be present
 * and of the right kind, or we fall back to the individual endpoints.
 * `current_errand` is nullable, so it is checked for PRESENCE, not truth;
 * `peak_hours` is optional here and seeded separately (see seedRunnerHome).
 */
const isUsableRunnerHomeAggregate = (payload: unknown): payload is RunnerHomeAggregate => {
  if (!payload || typeof payload !== 'object') return false;
  const h = payload as Partial<RunnerHomeAggregate>;
  const isObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  return (
    isObject(h.profile) &&
    isObject(h.earnings_today) &&
    isObject(h.earnings_week) &&
    Array.isArray(h.recent_errands) &&
    Array.isArray(h.available_errands) &&
    'current_errand' in payload
  );
};

/**
 * Seed every above-the-fold runner-dashboard cache from ONE request.
 *
 * The runner never got the treatment the customer side did: warm-up paid SIX
 * separate authenticated GETs before the success curtain lifted, each a full
 * framework boot + Sanctum auth on Forge. GET /runner/home returns all of them
 * at once — plus peak-hours, which was never warmed at all — so warm-up is a
 * single round trip and the demand nudge paints from cache for free.
 *
 * The cache keys, value shapes and TTLs written here are IDENTICAL to the
 * per-endpoint seeds above; the screens' useQuery keys are untouched and the
 * individual endpoints remain their revalidation paths. Any failure (network,
 * unavailable endpoint, unusable payload) transparently falls back to those
 * per-endpoint seeds, so this can only ever be faster, never less warm.
 */
async function seedRunnerHome(userId: string): Promise<void> {
  try {
    const response = await getRunnerHome();
    const home = response.data?.data;
    if (!isUsableRunnerHomeAggregate(home)) throw new Error('unusable runner home aggregate');

    // One timestamp for the whole snapshot — it IS one read.
    const fetchedAt = Date.now();
    const write = <T,>(keyParts: (string | number)[], value: T, ttl: number) =>
      CacheService.set<CachedEntry<T>>(buildKey(keyParts), { value, fetchedAt }, ttl);

    await Promise.all([
      write(['runner', 'profile', userId], home.profile, CacheTTL.LONG),
      write(['runner', 'earnings', 'today', userId], home.earnings_today, CacheTTL.MEDIUM),
      // The app's short form is 'week'; the API period is 'this_week'. The KEY
      // is what the hero reads — do not "fix" it to match the server.
      write(['runner', 'earnings', 'week', userId], home.earnings_week, CacheTTL.MEDIUM),
      write(['runner', 'errands', 'recent', userId], home.recent_errands, CacheTTL.LONG),
      // An OFFLINE runner legitimately has no offers. Seed the empty list
      // rather than skipping the key: "no offers" is the correct cold state,
      // and a missing key costs the screen the round trip this saves.
      write(['runner', 'errand', 'available', userId], home.available_errands, CacheTTL.SHORT),
      write(['runner', 'errand', 'current', userId], home.current_errand ?? null, CacheTTL.SHORT),
      // Shared across every runner — this key carries NO userId, because the
      // dashboard nudge and the Demand screen deliberately share one entry.
      // Only seed a well-formed grid; a malformed one would pin an empty
      // heatmap on Demand for the whole freshness window.
      ...(Array.isArray(home.peak_hours?.grid)
        ? [write(['runner', 'peak-hours', 30], home.peak_hours, CacheTTL.LONG)]
        : []),
    ]);
  } catch {
    // Best-effort, exactly like every other warm-up path: degrade to the
    // pre-aggregate per-endpoint seeds rather than leaving the dashboard cold.
    await runPool(runnerAboveFoldSeeds(userId));
  }
}

export async function preloadRunnerEssentials(userId: string) {
  // Above-the-fold runner dashboard data — the ONLY set the interactive login
  // path awaits before the success curtain lifts (profile, today's + week's
  // earnings, recent errands, available offers, current errand, peak hours).
  //
  // What used to be six separate requests here is now ONE — seedRunnerHome
  // fans GET /runner/home out into the same six cache keys (plus peak-hours,
  // free in the same payload) and falls back to those six requests if the
  // aggregate is unavailable. (P3)
  const aboveFold: Array<() => Promise<unknown>> = [
    () => preloadCoreImages(),
    () => seedRunnerHome(userId),
  ];

  // Below-the-fold — warmed in the BACKGROUND after the dashboard is interactive
  // (month/history earnings, full errand history, payouts, notifications, chat
  // list). Un-awaited; runPool swallows per-task rejections internally. (P3)
  const belowFold: Array<() => Promise<unknown>> = [
    () =>
      seed(
        ['runner', 'earnings', 'month', userId],
        async () => {
          const r = await runnerService.getEarnings('month');
          return r.data?.data ?? r.data ?? null;
        },
        CacheTTL.MEDIUM,
      ),
    () =>
      seed(
        ['runner', 'earnings', 'history', 'week', userId],
        async () => {
          const r = await runnerService.getEarningsHistory({ page: 1, per_page: 30 });
          return r.data?.data ?? r.data ?? [];
        },
        CacheTTL.MEDIUM,
      ),
    () =>
      seed(
        ['runner', 'errands', 'history', 'all', userId],
        async () => {
          const r = await runnerService.getErrandHistory({ page: 1, per_page: 15 });
          return r.data?.data ?? r.data ?? [];
        },
        CacheTTL.LONG,
      ),
    () =>
      seed(
        ['runner', 'payouts', userId],
        async () => {
          const r = await runnerService.getPayoutHistory({ page: 1, per_page: 5 });
          return r.data?.data ?? r.data ?? [];
        },
        CacheTTL.MEDIUM,
      ),
    // Prime the unread badge — a REQUEST, not a query-cache seed.
    //
    // The tab badge doesn't go through useQuery at all: useRealtimeNotifications
    // calls getUnreadCount() straight into the store and keeps it live over
    // Reverb. So the CacheService key this used to write was read by nothing.
    // What actually made the badge paint immediately was the side effect —
    // getUnreadCount() is an `api.get` with a 15s micro-cache, so warming it
    // here means the hook's own call on mount coalesces onto this one.
    // Keeping the request and dropping the dead write states that plainly.
    () => notificationService.getUnreadCount().then(() => undefined).catch(() => undefined),
    () =>
      seed(
        ['notifications', userId],
        async () => {
          const r = await notificationService.getNotifications({ page: 1, per_page: 20 });
          return (r.data?.data ?? []) as any[];
        },
        CacheTTL.MEDIUM,
      ),
    () => preloadConversationsList(userId),
  ];

  await runPool(aboveFold);
  void runPool(belowFold);
}

/** Auth warm-up for the authenticated role. */
export async function preloadAfterAuth(role: 'customer' | 'runner' | null, userId?: string | null) {
  await preloadCoreImages();
  if (!userId) return;
  try {
    if (role === 'runner') {
      await preloadRunnerEssentials(userId);
      return;
    }
    await preloadCustomerEssentials(userId);
  } catch {
    // Warm-up must never make a successful login look failed.
  }
}
