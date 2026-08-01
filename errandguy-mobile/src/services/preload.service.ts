import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { CacheService, CacheTTL } from './cache.service';
import { configService } from './config.service';
import { bookingService } from './booking.service';
import { paymentService } from './payment.service';
import { runnerService } from './runner.service';
import { notificationService } from './notification.service';
import { userService } from './user.service';
import { chatService } from './chat.service';
import { useChatStore } from '../stores/chatStore';
import { useBookingStore } from '../stores/bookingStore';
import { runPool } from '../utils/asyncPool';
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
  const aboveFold: Array<() => Promise<unknown>> = [
    () => preloadCoreImages(),
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
    () =>
      seed(
        ['notifications', 'unread', userId],
        async () => {
          const r = await notificationService.getUnreadCount();
          return r.data?.data ?? r.data ?? { count: 0 };
        },
        CacheTTL.SHORT,
      ),
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

export async function preloadRunnerEssentials(userId: string) {
  // Above-the-fold runner dashboard data — the ONLY set the interactive login
  // path awaits before the success curtain lifts (profile, today's + week's
  // earnings, recent errands, available offers, current errand). (P3)
  const aboveFold: Array<() => Promise<unknown>> = [
    () => preloadCoreImages(),
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
    () =>
      seed(
        ['notifications', 'unread', userId],
        async () => {
          const r = await notificationService.getUnreadCount();
          return r.data?.data ?? r.data ?? { count: 0 };
        },
        CacheTTL.SHORT,
      ),
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
