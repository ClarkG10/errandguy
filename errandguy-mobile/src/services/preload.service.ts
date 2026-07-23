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
import { runPool } from '../utils/asyncPool';
import type { Conversation, Message } from '../types';

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

export function preloadCoreImages() {
  if (!coreImagePreloadPromise) {
    coreImagePreloadPromise = Asset.loadAsync([...CORE_IMAGE_ASSETS])
      .then(() => {})
      .catch(() => {});
  }

  return coreImagePreloadPromise;
}

const preloadConversationMessages = async (conversations: Conversation[]) => {
  await Promise.all(
    conversations.slice(0, 4).map(async (conversation) => {
      try {
        const bookingId = conversation.booking_id;
        if (!bookingId) return;
        const response = await chatService.getMessages(bookingId, { limit: 50 });
        const messages = (response.data?.data ?? []) as Message[];
        useChatStore.getState().setMessages(bookingId, messages);
        await CacheService.set<Message[]>(`chat:messages:${bookingId}`, messages, CacheTTL.LONG);
      } catch {
        // Best-effort: opening the thread will fetch normally.
      }
    }),
  );
};

const preloadConversationsWithMessages = async (userId: string) => {
  const response = await chatService.getConversations();
  const conversations = (response.data?.data ?? []) as Conversation[];
  await CacheService.set<CachedEntry<Conversation[]>>(
    buildKey(['chat', 'conversations', userId]),
    { value: conversations, fetchedAt: Date.now() },
    CacheTTL.MEDIUM,
  );
  await preloadConversationMessages(conversations);
};

/**
 * Preload critical queries the user is about to need.
 *
 * Called once after a successful login / register / social-login,
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
  // Bounded-concurrency, order-preserving warm-up. Above-the-fold Home data
  // (errand-types, active booking, recent bookings, wallet balance) is listed
  // first so it warms in the first pool wave; lower-priority entries follow.
  // Entries are thunks so the pool — not JS — decides when each fires.
  await runPool([
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
    () => preloadConversationsWithMessages(userId),
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
  ]);
}

export async function preloadRunnerEssentials(userId: string) {
  // Bounded-concurrency, order-preserving warm-up (see preloadCustomerEssentials).
  // Above-the-fold runner dashboard data (profile, today's earnings, current /
  // available errands) leads; entries are thunks so the pool controls firing.
  await runPool([
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
        ['runner', 'errands', 'recent', userId],
        async () => {
          const r = await runnerService.getErrandHistory({ page: 1, per_page: 3 });
          return r.data?.data ?? r.data ?? [];
        },
        CacheTTL.LONG,
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
    () => preloadConversationsWithMessages(userId),
  ]);
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
