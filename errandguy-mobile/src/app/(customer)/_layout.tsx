import { useEffect, useMemo } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { useBookingStore } from '../../stores/bookingStore';
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications';
import { useBookingStatus } from '../../hooks/useBookingStatus';
import { useEchoChannel } from '../../hooks/useEchoChannel';
import { useQuery, invalidateQuery } from '../../hooks/useQuery';
import { bookingService } from '../../services/booking.service';
import { CacheTTL } from '../../services/cache.service';
import { mergeActiveBookings, parseActiveBookings } from '../../utils/activeBookings';
import { STACK_ANIMATION } from '../../constants/navigation';
import type { Booking } from '../../types';

export default function CustomerLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const segments = useSegments();

  // The threaded support surface (support/, support/[id]) is shared by both
  // roles: a runner reaching it from their Help screen must be allowed
  // through even though every OTHER (customer) route bounces runners back to
  // their own tabs. The root layout renders <Slot/>, so switching groups
  // unmounts the previous group — there is no concurrent double-mount of the
  // realtime notifications subscription to worry about.
  const inSharedSupport = (segments as unknown as string[]).includes('support');
  const runnerBounced = role === 'runner' && !inSharedSupport;

  // Subscribe to realtime notifications for the current user
  useRealtimeNotifications(user?.id ?? null);

  // Keep the live errand fresh for the WHOLE customer group, not just the
  // tracking screen. The home card renders bookingStore.activeBooking, which
  // useBookingStatus merges the `booking.{id}` payload into — so a status move
  // heals the card in place instead of freezing on "Finding you a runner"
  // until the user backgrounds the app or taps through.
  //
  // Mounted here (the group layout) so it survives tab switches. Passing null
  // when there is no live errand disables the subscription entirely, and while
  // the tracking screen is open its own subscription simply shares the same
  // refcounted channel — the merge is idempotent.
  const activeBookingId = useBookingStore((s) => s.activeBooking?.id ?? null);
  useBookingStatus(activeBookingId);

  // …and the OTHER live errands. A customer routinely has more than one active
  // booking (a live errand plus one scheduled for later, or two errands at
  // once), but the store holds exactly one and the subscription above followed
  // it — so every other in-flight errand received no realtime updates at all
  // and sat frozen until a manual refresh. Same key/TTL as the home screen's
  // own list query, so the two share the cached list and the api layer's GET
  // dedupe collapses their fetches into one request.
  const activeListQ = useQuery<Booking[]>(
    ['bookings', 'active-list', user?.id ?? 'anon'],
    async () => {
      const res = await bookingService.getActiveBooking();
      return parseActiveBookings(res.data);
    },
    {
      staleTime: 30_000,
      ttl: CacheTTL.SHORT,
      enabled: isAuthenticated && role === 'customer' && !!user?.id,
    },
  );

  // Exactly the errands Home renders as cards, minus the one the subscription
  // above already covers — same merge, same cap, so we can never hold a
  // channel for a booking that has no card (or miss one that does).
  const secondaryBookingIds = useMemo(
    () =>
      mergeActiveBookings<{ id: string }>(
        activeBookingId ? { id: activeBookingId } : null,
        (activeListQ.data ?? []).flatMap((b) => (b?.id ? [{ id: b.id }] : [])),
      )
        .map((b) => b.id)
        .filter((id) => id !== activeBookingId),
    [activeListQ.data, activeBookingId],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/welcome');
    } else if (runnerBounced) {
      router.replace('/(runner)/(tabs)');
    }
  }, [isAuthenticated, runnerBounced, router]);

  if (!isAuthenticated || runnerBounced) {
    return null;
  }

  // Use Stack (not Slot) so router.back() pops to the previous screen
  // within this group (e.g. Profile → Wallet → back returns to Profile,
  // not to the home tab the user happened to visit earlier).
  //
  // The watchers render null; they live beside the Stack (never inside it, so
  // expo-router still sees only routes) and are keyed by booking id, which is
  // what lets each one own exactly one refcounted channel.
  return (
    <>
      {secondaryBookingIds.map((id) => (
        <SecondaryBookingWatcher key={id} bookingId={id} />
      ))}
      <Stack screenOptions={{ headerShown: false, animation: STACK_ANIMATION }} />
    </>
  );
}

/**
 * Realtime for an active booking that is NOT the store's `activeBooking`.
 *
 * Deliberately NOT useBookingStatus: that hook merges whatever arrives into
 * bookingStore.activeBooking, and BookingStatusChanged::broadcastWith() carries
 * the booking's own `id` — so pointing it at a second booking would splice that
 * booking's id and status onto the primary one, and the home card would deep
 * link to the wrong errand. Here we only invalidate the active list, which the
 * home screen re-reads (one GET, api-deduped) to heal the right card.
 */
function SecondaryBookingWatcher({ bookingId }: { bookingId: string }) {
  useEchoChannel({
    channel: `booking.${bookingId}`,
    event: 'booking.status',
    onEvent: () => {
      // Narrow on purpose: only the active-errand stack. The broader
      // ['bookings'] prefix would also drop the recent-bookings window and the
      // Activity lists, i.e. several refetches for one status tick.
      invalidateQuery(['bookings', 'active-list']);
    },
  });
  return null;
}
