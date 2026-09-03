import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import {
  Package,
  Bell,
  Search,
  ArrowRight,
  Repeat,
  CalendarClock,
  LifeBuoy,
  TrendingUp,
  Clock,
  ChevronRight,
  X,
  Ticket,
  Wallet,
  Gift,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore, type DraftBooking } from '../../../stores/bookingStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { bookingService } from '../../../services/booking.service';
import { warmTracking } from '../../../services/preload.service';
import { configService, type Promo } from '../../../services/config.service';
import { paymentService } from '../../../services/payment.service';
import { userService, type ReferralInfo } from '../../../services/user.service';
import { useQuery } from '../../../hooks/useQuery';
import { useHideTabBarOnScroll } from '../../../hooks/useHideTabBarOnScroll';
import { CacheTTL } from '../../../services/cache.service';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';
import { Avatar } from '../../../components/ui/Avatar';
import {
  ActiveBookingCard,
  isRenderableActiveBooking,
} from '../../../components/customer/ActiveBookingCard';
import { BookingDetailSheet } from '../../../components/customer/BookingDetailSheet';
import { ErrandTypeIcon } from '../../../components/ui/ErrandTypeIcon';
import { ErrorState } from '../../../components/ui/ErrorState';
import { HomeSkeleton } from '../../../components/ui/Skeleton';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { Eyebrow } from '../../../components/ui/Typography';
import { STATUS_LABELS, STATUS_COLORS } from '../../../constants/statusLabels';
import { useResponsive } from '../../../constants/responsive';
import { LightColors, Elevation } from '../../../constants/colors';
import type { Booking, ErrandType } from '../../../types';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatRelativeTime } from '../../../utils/formatDate';
import { scheduledWindowLabel, SCHEDULED_MATCH_LEAD_MINUTES } from '../../../utils/scheduledBooking';
import {
  mergeActiveBookings,
  parseActiveBookings,
} from '../../../utils/activeBookings';
import {
  applyErrandTypeOrder,
  rankErrandTypesByUsage,
} from '../../../utils/errandTypeOrder';

const ICON_MAP: Record<string, LucideIcon> = {
  Package,
};

// Persisted `currentStep` → the book/ route the user was last on. The
// booking screens read the (already-hydrated) draft straight from the
// store, so deep-linking here needs no params — just the right route.
// Keyed by the step values the flow persists (type→1, details→2,
// schedule→3); step 0 has no resume affordance.
const RESUME_STEP_ROUTES: Record<number, string> = {
  1: '/(customer)/book/details',
  2: '/(customer)/book/schedule',
  3: '/(customer)/book/review',
};

// Terminal-success statuses whose full route/items we're willing to clone
// straight onto Review (a fresh, clean repeat). Cancelled/no_runner
// deliberately excluded — a "repeat" of a failed errand isn't a happy-path.
const REPEATABLE_STATUSES = ['completed', 'delivered'];

// Promos within this window read as "expiring" — worth nudging before they
// lapse. Anything past it is just a standard available promo.
const PROMO_EXPIRY_SOON_MS = 7 * 24 * 60 * 60 * 1000;

// Paged active-errand stack geometry. The zone inset is the screen's 20pt page
// margin plus hs.activeZone's 12pt padding; the peek is how much of the next
// card stays visible so the stack announces itself without an extra label.
const ACTIVE_ZONE_INSET = 32;
const ACTIVE_CARD_PEEK = 30;
const ACTIVE_CARD_GAP = 10;

/**
 * Clone a terminal booking into a fresh booking draft so "Repeat last" can
 * drop the customer straight onto the pre-filled Review screen — no backend
 * round-trip. Mirrors buildDraftFromBooking in BookingDetailSheet.tsx (kept
 * local so the home screen doesn't have to widen that component's exports).
 *
 * When the source lacks pickup coordinates the route can't be reconstructed,
 * so we degrade to seeding just the errand type and let the caller re-pick.
 */
function buildDraftFromBooking(b: Booking): Partial<DraftBooking> {
  const slug = b.errand_type?.slug;
  const typeSeed: Partial<DraftBooking> = {
    errand_type_id: b.errand_type_id,
    ...(slug ? { errand_type_slug: slug } : {}),
  };

  const hasPickupCoords = b.pickup_lat != null && b.pickup_lng != null;
  if (!hasPickupCoords) return typeSeed;

  return {
    ...typeSeed,
    pickup_address: b.pickup_address,
    pickup_lat: b.pickup_lat,
    pickup_lng: b.pickup_lng,
    ...(b.pickup_contact_name ? { pickup_contact_name: b.pickup_contact_name } : {}),
    ...(b.pickup_contact_phone ? { pickup_contact_phone: b.pickup_contact_phone } : {}),
    ...(b.dropoff_address != null ? { dropoff_address: b.dropoff_address } : {}),
    ...(b.dropoff_lat != null ? { dropoff_lat: b.dropoff_lat } : {}),
    ...(b.dropoff_lng != null ? { dropoff_lng: b.dropoff_lng } : {}),
    ...(b.dropoff_contact_name ? { dropoff_contact_name: b.dropoff_contact_name } : {}),
    ...(b.dropoff_contact_phone ? { dropoff_contact_phone: b.dropoff_contact_phone } : {}),
    ...(b.description != null ? { description: b.description } : {}),
    ...(b.special_instructions != null
      ? { special_instructions: b.special_instructions }
      : {}),
    ...(b.estimated_item_value != null
      ? { estimated_item_value: b.estimated_item_value }
      : {}),
    ...(b.shopping_budget != null ? { shopping_budget: b.shopping_budget } : {}),
    ...(b.pricing_mode ? { pricing_mode: b.pricing_mode } : {}),
    ...(b.vehicle_type_rate ? { vehicle_type_rate: b.vehicle_type_rate } : {}),
    ...(b.customer_offer != null ? { customer_offer: b.customer_offer } : {}),
    ...(b.shopping_items && b.shopping_items.length > 0
      ? {
          shoppingItems: b.shopping_items.map((it) => ({
            id: it.id,
            name: it.name,
            qty: it.qty,
          })),
        }
      : {}),
    // Deliberately NOT cloned: promo_code (single-use/expiry) and any payment
    // selection — the customer re-confirms those on Review.
  };
}

/**
 * Customer Home — radically simplified.
 *
 * The previous iteration stacked: header strip → eyebrow → headline →
 * search → eyebrow → service grid → eyebrow → recent. Three "eyebrow +
 * title" pairs on one screen reads as cluttered no matter how clean
 * each individual block is.
 *
 * This version collapses to ONE focal hero (the address-style search)
 * and three thin supporting strips. The whole screen should be visually
 * scannable in under a second:
 *
 *   • Top — avatar (left) + greeting+name in one line + bell (right).
 *     A single horizontal band, not three stacked sections.
 *   • Hero — a tall "Where are we going?" card with two location rows
 *     (pickup + drop-off placeholders). Mirrors the way ride-hailing
 *     apps (Grab, Uber, Bolt) anchor their home screen on the
 *     destination question rather than on a tile dashboard.
 *   • Active errand — only when one exists.
 *   • Service shortcuts — a tight icon-only horizontal strip. Names
 *     under each icon, no card chrome, no per-tile "from ₱X" pricing
 *     noise (that lives one tap deeper on the Type screen).
 *   • Recent — at most three rows, plain text, separated by hairlines.
 *     A "See all" link sits inline with the section label, not as its
 *     own row.
 */
export default function CustomerHomeScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useResponsive();
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const updateDraft = useBookingStore((s) => s.updateDraft);
  const draftBooking = useBookingStore((s) => s.draftBooking);
  const draftStep = useBookingStore((s) => s.currentStep);
  const setDraftStep = useBookingStore((s) => s.setStep);
  const isDraftHydrated = useBookingStore((s) => s.isDraftHydrated);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const hideOnScroll = useHideTabBarOnScroll();

  const enabled = role === 'customer';

  const errandTypesQ = useQuery<ErrandType[]>(
    ['errand-types'],
    async () => {
      const res = await configService.getErrandTypes();
      const t = res.data?.data;
      return Array.isArray(t) ? t : [];
    },
    { staleTime: 60 * 60 * 1000, ttl: CacheTTL.STATIC, enabled },
  );

  const recentBookingsQ = useQuery<Booking[]>(
    ['bookings', 'recent', user?.id ?? 'anon'],
    async () => {
      // 10, not 3: the UI shows only 3 rows, but the "frequently booked"
      // signal below needs a meaningful window to count types over.
      const res = await bookingService.getBookings({ per_page: 10 });
      const b = res.data?.data;
      return Array.isArray(b) ? b : [];
    },
    { staleTime: 60_000, ttl: CacheTTL.LONG, enabled: enabled && !!user?.id },
  );

  const activeBookingQ = useQuery<Booking | null>(
    ['booking', 'active', user?.id ?? 'anon'],
    async () => {
      const res = await bookingService.getActiveBooking();
      return (res.data?.data ?? null) as Booking | null;
    },
    { staleTime: 30_000, ttl: CacheTTL.SHORT, enabled: enabled && !!user?.id },
  );

  // Every in-flight errand, not just the top-ranked one: same endpoint as the
  // query above, but reading the additive `active_bookings` array, so a second
  // live errand gets its own card instead of vanishing into Activity. Falls
  // back to the singular row when the array isn't there (older API / a body
  // cached before it shipped), which makes this strictly additive.
  //
  // Deliberately a SEPARATE key from ['booking','active',…]: that one is the
  // singular contract the boot snapshot seeds and the store is fed from, so it
  // keeps painting card #1 instantly on a cold start while this one fetches.
  // Cost of that split: whenever both queries fetch at once (focus
  // revalidation, pull-to-refresh) the api layer's in-flight dedupe collapses
  // them into one GET. On a COLD start this used to be a genuine extra
  // request — preload.service now seeds this key too, from the /customer/home
  // aggregate's `active_bookings` section, so both paint from the snapshot.
  // (That seed is conditional: an older API omits the section, and pinning an
  // empty array over a live errand would be worse than fetching.)
  const activeBookingsQ = useQuery<Booking[]>(
    ['bookings', 'active-list', user?.id ?? 'anon'],
    async () => {
      const res = await bookingService.getActiveBooking();
      return parseActiveBookings(res.data);
    },
    { staleTime: 30_000, ttl: CacheTTL.SHORT, enabled: enabled && !!user?.id },
  );

  // ── Rewards band sources ──────────────────────────────────────────────
  // All three mirror the exact useQuery keys/shapes the Profile tab already
  // prefetches (see preload.service: prefetchPromos / prefetchReferral and the
  // ['wallet','balance'] warm), so a returning user's band paints from cache
  // with no extra network round-trip. Each degrades to empty on a missing
  // backend, which collapses its pill (see rewardItems) rather than erroring.
  const promosQ = useQuery<Promo[]>(
    ['promos', user?.id ?? 'anon'],
    async () => {
      const res = await configService.getPromos();
      const p = res.data?.data;
      return Array.isArray(p) ? p : [];
    },
    { staleTime: 60_000, ttl: CacheTTL.MEDIUM, enabled: enabled && !!user?.id },
  );

  const walletBalanceQ = useQuery<number>(
    ['wallet', 'balance', user?.id ?? 'anon'],
    async () => {
      const res = await paymentService.getWalletBalance();
      // Return the NUMBER (not the balance object) to match the wallet screen's
      // shared cache entry — seeding the object poisons the key.
      return (res.data?.data?.balance ?? res.data?.balance ?? 0) as number;
    },
    { staleTime: 30_000, ttl: CacheTTL.SHORT, enabled: enabled && !!user?.id },
  );

  const referralQ = useQuery<ReferralInfo | null>(
    ['user', 'referral', user?.id ?? 'anon'],
    async () => {
      const res = await userService.getReferral();
      return (res.data?.data ?? null) as ReferralInfo | null;
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM, enabled: enabled && !!user?.id },
  );

  const errandTypes = useMemo(
    () => (errandTypesQ.data ?? []).filter((t) => t.is_active),
    [errandTypesQ.data],
  );

  // ── Personalised service order ────────────────────────────────────────
  // The catalogue arrives in ONE global sort_order and Home shows its first
  // four tiles, so a customer whose regular service is 5th (laundry) or 7th
  // (bills) never saw their own tile — "See all" then scroll, on every single
  // booking. The recent-bookings window this screen already loads says what
  // they actually book, so we rank the catalogue by it (2+ bookings to be
  // promoted, ties keep sort_order — see utils/errandTypeOrder).
  //
  // The ranking is computed ONCE per session and then replayed, because a
  // recomputation on every window change would reshuffle the tiles under the
  // user's thumb — muscle memory is most of the value here. A newly booked
  // type therefore moves up on the next launch, not mid-session. Pinned per
  // user id so a sign-in as somebody else can't inherit the previous order.
  //
  // The window it counts over is whatever is cached when both queries first
  // resolve: 10 from this screen's own fetcher, but 5 on a cold start, because
  // the boot snapshot seeds this same key from /customer/home
  // (HomeController::RECENT_BOOKINGS). Two bookings of a type still promote it
  // out of five, so the rule holds either way — raising that constant to 10
  // just sharpens the signal on the first launch of a session.
  const [pinnedTypeOrder, setPinnedTypeOrder] = useState<{
    userId: string;
    ids: string[];
  } | null>(null);
  const typeOrderUserId = user?.id ?? 'anon';
  useEffect(() => {
    if (!enabled) return;
    if (pinnedTypeOrder?.userId === typeOrderUserId) return;
    // Wait for both inputs to resolve once — pinning a catalogue-order
    // fallback while the bookings are still loading would freeze exactly the
    // layout this is meant to replace.
    if (errandTypes.length === 0) return;
    if (recentBookingsQ.loading) return;
    setPinnedTypeOrder({
      userId: typeOrderUserId,
      ids: rankErrandTypesByUsage(errandTypes, recentBookingsQ.data ?? []).map(
        (t) => t.id,
      ),
    });
  }, [
    enabled,
    errandTypes,
    recentBookingsQ.data,
    recentBookingsQ.loading,
    pinnedTypeOrder,
    typeOrderUserId,
  ]);

  const orderedTypes = useMemo(
    () =>
      applyErrandTypeOrder(
        errandTypes,
        pinnedTypeOrder?.userId === typeOrderUserId ? pinnedTypeOrder.ids : null,
      ),
    [errandTypes, pinnedTypeOrder, typeOrderUserId],
  );

  // Keep the home dashboard simple — surface only the most common
  // errand types here (now "most common FOR THIS CUSTOMER"). The full list
  // lives one tap deeper on the booking type screen ("See all").
  const featuredTypes = orderedTypes.slice(0, 4);
  const recentBookings = (recentBookingsQ.data ?? []).slice(0, 3);
  const initialLoading =
    enabled && (errandTypesQ.loading || recentBookingsQ.loading) &&
    errandTypes.length === 0 && recentBookings.length === 0;

  // Sync active booking into the global store, but skip the very first
  // pre-resolution undefined so we don't clobber any push-notification
  // hydrated value.
  useEffect(() => {
    if (activeBookingQ.loading && activeBookingQ.data == null) return;
    setActiveBooking(activeBookingQ.data ?? null);
  }, [activeBookingQ.data, activeBookingQ.loading, setActiveBooking]);

  // ── The live-errand stack ─────────────────────────────────────────────
  // The store's singular booking stays authoritative for card #1 (it is what
  // the realtime `booking.{id}` channel heals in place, and what the rest of
  // the app reads), with the fetched list adding the errands that used to be
  // invisible. Capped by mergeActiveBookings at the same 3 the server caps
  // `active_bookings` at.
  const activeCards = useMemo(
    () =>
      mergeActiveBookings(
        isRenderableActiveBooking(activeBooking) ? activeBooking : null,
        (activeBookingsQ.data ?? []).filter(isRenderableActiveBooking),
      ),
    [activeBooking, activeBookingsQ.data],
  );
  // Paged card index — only meaningful with more than one card. Clamped when
  // an errand completes and the stack shrinks under the current page.
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  useEffect(() => {
    setActiveCardIndex((i) => Math.min(i, Math.max(0, activeCards.length - 1)));
  }, [activeCards.length]);

  const [refreshing, setRefreshing] = useState(false);
  // Recent rows open the same detail sheet Activity uses — tap parity
  // between the two lists (tracking stays one tap deeper, via the sheet
  // or the ActiveBookingCard).
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  // The "Continue your errand" card is dismissible for the current
  // session only — a dismiss hides the card but leaves the persisted
  // draft intact, so it reappears on the next launch (until the draft
  // expires at 24h or is resumed/replaced).
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      errandTypesQ.refresh(),
      recentBookingsQ.refresh(),
      activeBookingQ.refresh(),
      activeBookingsQ.refresh(),
      promosQ.refresh(),
      walletBalanceQ.refresh(),
      referralQ.refresh(),
    ]);
    setRefreshing(false);
  }, [
    errandTypesQ,
    recentBookingsQ,
    activeBookingQ,
    activeBookingsQ,
    promosQ,
    walletBalanceQ,
    referralQ,
  ]);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  // The explicit "new errand" path — hero, destination card, service
  // tiles, "see all", schedule/repeat pills. This is the ONLY place that
  // clears the draft: starting a fresh booking intentionally discards any
  // abandoned one. Resuming (below) deliberately does NOT clear.
  const startBooking = useCallback(
    (preselectedTypeId?: string) => {
      clearDraft();
      // A tile/chip tap has ALREADY answered "What do you need?" — replaying
      // the type screen just to have the user re-confirm and tap Continue
      // costs a whole screen at the highest-frequency entry point. When the
      // tapped id resolves against the loaded catalogue (home and type.tsx
      // share the ['errand-types'] cache key, so it almost always does) we do
      // exactly what type.tsx's Continue does — seed id + slug, mark step 1 —
      // and land on details. The type-change field cleanup there is a no-op
      // for us because clearDraft() just emptied the draft.
      //
      // The type screen stays the entry for undecided users ("See all", the
      // FAB, the rate-screen rebook deep link) and is still one back-press
      // from details for switching. If the catalogue hasn't loaded (cold
      // start, offline) we fall back to the old preselect route rather than
      // seed a slug-less draft, which would give details.tsx the wrong
      // errand-type rule.
      // Read the query's own data (state-stable across renders) rather than
      // the per-render `errandTypes` filter result, so this callback keeps a
      // stable identity.
      const preselectedType = preselectedTypeId
        ? errandTypesQ.data?.find(
            (t) => t.id === preselectedTypeId && t.is_active,
          )
        : undefined;
      if (preselectedType?.slug) {
        updateDraft({
          errand_type_id: preselectedType.id,
          errand_type_slug: preselectedType.slug,
        });
        setDraftStep(1);
        router.push('/(customer)/book/details');
        return;
      }
      router.push(
        preselectedTypeId
          ? {
              pathname: '/(customer)/book/type',
              params: { preselected: preselectedTypeId },
            }
          : '/(customer)/book/type',
      );
    },
    [clearDraft, updateDraft, setDraftStep, errandTypesQ.data, router],
  );

  // "Repeat last" / frequently-booked → clone a prior terminal-success
  // booking's FULL draft (type + addresses + items) straight onto Review,
  // instead of only re-picking the errand type. When the source can't rebuild
  // a route (no pickup coords) we degrade to the type-only start so the user
  // just re-picks locations, never a dead-end. `fallbackTypeId` covers the
  // case where there's no repeatable booking at all (seed the type only).
  const repeatFrom = useCallback(
    (source: Booking | null | undefined, fallbackTypeId?: string) => {
      if (source) {
        const draft = buildDraftFromBooking(source);
        if (draft.pickup_lat != null) {
          // Full seed → clean replacement of any half-filled draft, then Review.
          clearDraft();
          updateDraft(draft);
          router.push('/(customer)/book/review');
          return;
        }
      }
      // No coords (or no source) → fall back to the type-only new-booking flow.
      startBooking(fallbackTypeId ?? source?.errand_type_id);
    },
    [clearDraft, updateDraft, router, startBooking],
  );

  // Resumable mid-flow draft. We only surface the card once the persisted
  // draft has hydrated, the user got past the first step, and the draft
  // actually holds something — otherwise there is nothing to continue.
  const resumeInfo = useMemo(() => {
    if (!isDraftHydrated || resumeDismissed) return null;
    if (draftStep <= 0) return null;
    if (Object.keys(draftBooking).length === 0) return null;
    const route = RESUME_STEP_ROUTES[draftStep];
    if (!route) return null;
    const draftType = errandTypes.find(
      (t) => t.id === draftBooking.errand_type_id,
    );
    const typeName =
      draftType?.name ?? draftBooking.errand_type_slug ?? 'errand';
    return {
      route,
      typeName,
      iconName: draftType?.icon_name,
      // Mirror BookingStepIndicator's 1-based "Step N of 4" wording.
      stepNumber: Math.min(draftStep + 1, 4),
    };
  }, [
    isDraftHydrated,
    resumeDismissed,
    draftStep,
    draftBooking,
    errandTypes,
  ]);

  // Deep-link back into the flow WITHOUT clearing the draft — the target
  // screen pre-fills from the already-hydrated store.
  const resumeBooking = useCallback(() => {
    if (!resumeInfo) return;
    router.push(resumeInfo.route as any);
  }, [resumeInfo, router]);

  // Section eyebrow. With one card it names what the card is; with several it
  // states the count, which is also the only place the stack's size is spoken
  // (the page dots are hidden from screen readers).
  const activeEyebrow =
    activeCards.length > 1
      ? `Your errands · ${activeCards.length} active`
      : scheduledWindowLabel(activeCards[0]) !== null
        ? 'Scheduled errand'
        : 'Your errand';

  // Card geometry for the paged stack: the page margin (20) plus the tinted
  // zone's padding (12) on each side, minus a peek so the next card is visibly
  // there. Only used when there is more than one card — a single errand keeps
  // the full-width card exactly as before.
  const activeCardWidth = Math.max(
    220,
    winWidth - ACTIVE_ZONE_INSET * 2 - ACTIVE_CARD_PEEK,
  );
  const activeCardStride = activeCardWidth + ACTIVE_CARD_GAP;

  // Wrap a raw-Pressable handler with a light impact haptic — these
  // don't get the shared Button's press haptic. Applied to every
  // navigational surface (hero, destination card, tiles, pills, rows,
  // chrome chips); inline "See all" text links stay silent on purpose
  // so buttons and links keep distinct interaction vocabularies.
  const withLightImpact = useCallback(
    (fn: () => void) => () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      fn();
    },
    [],
  );

  // One live-errand card. A SCHEDULED errand stays `pending` until the server
  // starts matching (~15 min before its window), so ActiveBookingCard — which
  // maps `pending` straight to the searching phase — would show "Looking for a
  // runner nearby…" under a pulsing dot for hours or days on an errand nobody
  // is even looking at yet. That reads as a stuck search and drives
  // cancellations and support chats. Outside the match window we swap in a
  // calm, static card that simply states WHEN it runs; once the window opens
  // (or a runner is on it) the normal live card takes back over.
  //
  // Recomputed per render off the device clock — no timer. A few minutes of
  // clock skew at the boundary is cosmetic, and the next poll/focus render
  // corrects it.
  const renderActiveCard = useCallback(
    (booking: Booking) => {
      // Warm the tracking fetch on the same tap so the screen's mount GET
      // coalesces (the card's booking is already in hand, so the paint is
      // instant regardless). (P2)
      const open = () => {
        warmTracking(booking);
        router.push(`/(customer)/tracking/${booking.id}`);
      };
      const label = scheduledWindowLabel(booking);
      return label ? (
        // Same destination as the live card so the tap target is consistent
        // (tracking owns cancel / details).
        <ScheduledErrandCard
          booking={booking}
          label={label}
          onPress={withLightImpact(open)}
        />
      ) : (
        // ActiveBookingCard fires its own press haptic — don't double up.
        <ActiveBookingCard booking={booking} onPress={open} />
      );
    },
    [router, withLightImpact],
  );

  // "Frequently booked" personalization — computed purely from the
  // already-loaded recent bookings (no extra fetch). Only surfaces once
  // a single errand type has been booked 3+ times in the loaded window.
  const frequentType = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const b of recentBookingsQ.data ?? []) {
      if (!b.errand_type_id) continue;
      const entry = counts.get(b.errand_type_id);
      if (entry) entry.count += 1;
      else
        counts.set(b.errand_type_id, {
          id: b.errand_type_id,
          name: b.errand_type?.name ?? 'errand',
          count: 1,
        });
    }
    let best: { id: string; name: string; count: number } | null = null;
    for (const entry of counts.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    return best && best.count >= 3 ? best : null;
  }, [recentBookingsQ.data]);

  // The most recent repeatable booking OF the frequently-booked type — lets the
  // "Frequently booked" chip seed a full draft too (falls back to type-only).
  const frequentSource = useMemo(() => {
    if (!frequentType) return null;
    return (
      (recentBookingsQ.data ?? []).find(
        (b) =>
          b.errand_type_id === frequentType.id &&
          REPEATABLE_STATUSES.includes(b.status),
      ) ?? null
    );
  }, [frequentType, recentBookingsQ.data]);

  // Quick actions — compact pills under the destination card.
  // Contextual: "Repeat last" only when there's a recent booking. No
  // "Track" pill — when an errand is live the ActiveBookingCard renders
  // directly above these pills, so a pill would duplicate it.
  const lastBooking = recentBookings[0];
  // The most recent booking we can fully clone (terminal-success + a type).
  // "Repeat last" seeds from this when present; otherwise it falls back to the
  // last booking's type only.
  const repeatSource = useMemo(
    () =>
      (recentBookingsQ.data ?? []).find(
        (b) => REPEATABLE_STATUSES.includes(b.status) && !!b.errand_type_id,
      ) ?? null,
    [recentBookingsQ.data],
  );
  const quickActions: {
    key: string;
    label: string;
    icon: LucideIcon;
    a11yLabel: string;
    onPress: () => void;
  }[] = [
    ...(lastBooking?.errand_type_id
      ? [
          {
            key: 'repeat',
            label: 'Repeat last',
            icon: Repeat,
            a11yLabel: `Repeat your last ${
              repeatSource?.errand_type?.name ??
              lastBooking.errand_type?.name ??
              'errand'
            } booking`,
            onPress: () => repeatFrom(repeatSource, lastBooking.errand_type_id),
          },
        ]
      : []),
    {
      key: 'schedule',
      label: 'Schedule',
      icon: CalendarClock,
      a11yLabel: 'Schedule an errand for later',
      // Carry the intent instead of dropping it: the pill used to be a plain
      // "new errand" start, so the user had to re-declare "later" on step 3.
      // Seeding schedule_type makes the schedule step open already on
      // "Scheduled" with the quick-pick chips ready — zero new UI. The write
      // has to land AFTER startBooking()'s clearDraft() (both are synchronous
      // zustand sets, so this ordering holds); Continue on that step still
      // blocks until a time is picked, and the user can toggle back to Now.
      onPress: () => {
        startBooking();
        updateDraft({ schedule_type: 'scheduled' });
      },
    },
    {
      key: 'help',
      label: 'Help',
      icon: LifeBuoy,
      a11yLabel: 'Open the help center',
      onPress: () => router.push('/(customer)/help' as any),
    },
  ];

  // Rewards band — a slim, self-collapsing strip that surfaces value the user
  // already holds: redeemable/expiring promos, wallet credit, and an invite
  // teaser. Each entry only materializes when it has something real to say, so
  // an empty band renders NOTHING (see the length guard in the JSX). Amber is
  // the reward family here (accentSoft surface) with a blue chevron as the CTA.
  const rewardItems = useMemo(() => {
    const items: {
      key: string;
      icon: LucideIcon;
      label: string;
      a11yLabel: string;
      onPress: () => void;
    }[] = [];

    const promos = promosQ.data ?? [];
    if (promos.length > 0) {
      const now = Date.now();
      let soonest: number | null = null;
      for (const p of promos) {
        if (!p.valid_until) continue;
        const t = new Date(p.valid_until).getTime();
        if (!Number.isFinite(t) || t < now) continue;
        if (soonest == null || t < soonest) soonest = t;
      }
      const expiringSoon =
        soonest != null && soonest - now <= PROMO_EXPIRY_SOON_MS;
      const label = expiringSoon
        ? 'Promo expiring soon'
        : promos.length === 1
          ? '1 promo to use'
          : `${promos.length} promos to use`;
      items.push({
        key: 'promos',
        icon: Ticket,
        label,
        a11yLabel: `${label}. Open promos and offers`,
        onPress: () => router.push('/(customer)/promos' as any),
      });
    }

    const balance = walletBalanceQ.data;
    if (typeof balance === 'number' && balance > 0) {
      const money = formatCurrency(balance);
      items.push({
        key: 'wallet',
        icon: Wallet,
        label: `${money} credit`,
        a11yLabel: `Wallet credit ${money}. Open your wallet`,
        onPress: () => router.push('/(customer)/wallet' as any),
      });
    }

    // Invite teaser — only once the referral endpoint has actually returned a
    // shareable code. No referral data ⇒ no pill, so the band stays honest and
    // can still fully collapse when there's genuinely nothing to show.
    if (referralQ.data?.referral_code) {
      items.push({
        key: 'invite',
        icon: Gift,
        label: 'Invite & earn',
        a11yLabel: 'Invite friends and earn rewards',
        onPress: () => router.push('/(customer)/referral' as any),
      });
    }

    return items;
  }, [promosQ.data, walletBalanceQ.data, referralQ.data, router]);

  // Compact hero — just enough blue for the safe-area inset, the greeting +
  // search chrome, and a slim gradient band the destination card floats over.
  // (The mascot that used to fill this space is gone, so it no longer needs
  // to be a third of the screen.)
  const heroHeight = insets.top + (activeCards.length > 0 ? 84 : 112);

  if (initialLoading) {
    // No SafeAreaView here — the skeleton mirrors the shipped hero and
    // handles its own top inset so it draws edge-to-edge like the real
    // screen. Its hero placeholder is light, so dark icons stay legible.
    return (
      <View className="flex-1 bg-background">
        {isFocused && <StatusBar barStyle="dark-content" />}
        <HomeSkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Light icons over the dark-blue hero gradient; gated on focus so
          sibling tabs (light backgrounds) fall back to the default style
          when this screen isn't frontmost. */}
      {isFocused && <StatusBar barStyle="light-content" />}
      <ScrollView
        {...hideOnScroll}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        // Reserve room at the bottom so the floating QuickBookFAB
        // never covers the last row (the previous 32pt left the FAB
        // disc sitting on top of the price text).
        contentContainerStyle={{ paddingBottom: TAB_CONTENT_BOTTOM_INSET }}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Brand hero — ride-hailing home pattern with floating chrome
            (avatar, greeting pill, bell). We deliberately do NOT render a
            live map here: a decorative home map would stream billed HERE
            tiles on every visit. Instead a static brand gradient fills the
            top; tapping it starts a booking (where the map opens on demand),
            same as the destination card. */}
        <View style={[hs.mapHero, { height: heroHeight }]}>
          <LinearGradient
            pointerEvents="none"
            colors={[
              LightColors.gradientStart,
              LightColors.gradientMid,
              LightColors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* Warm brand sheen — a faint gold glow that only reaches the
              bottom-right corner (first two stops are transparent). The
              greeting sits over the SOLID blue upper-left, so white-text
              contrast is untouched; this just revives the dead terminal
              stop with a subtle "Guy" gold warmth rather than a flat blue. */}
          <LinearGradient
            pointerEvents="none"
            colors={[
              `${LightColors.accent}00`,
              `${LightColors.accent}00`,
              `${LightColors.accent}1A`,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* Fade the hero into the canvas so the content below reads
              as one continuous surface. */}
          <LinearGradient
            pointerEvents="none"
            colors={[
              `${LightColors.background}00`,
              `${LightColors.background}00`,
              LightColors.background,
            ]}
            style={hs.mapFade}
          />
          {/* Tap target starts BELOW the chrome band (inset top + chip
              row + hitSlop clearance) so a missed bell/avatar tap can't
              clear the draft and launch the booking flow. */}
          <Pressable
            style={({ pressed }) => [
              {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                top: insets.top + 56,
              },
              pressed && { backgroundColor: 'rgba(255,255,255,0.08)' },
            ]}
            android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
            onPress={withLightImpact(() => startBooking())}
            accessibilityRole="button"
            accessibilityLabel="Start a new booking"
          />

          <SafeAreaView edges={['top']} pointerEvents="box-none">
            <View className="flex-row items-center px-5 pt-2" pointerEvents="box-none">
              <Pressable
                onPress={withLightImpact(() =>
                  router.push('/(customer)/(tabs)/profile'),
                )}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Open profile"
                // Box on className (NativeWind drops the fill/round/centering from
                // a function-only style with no className) + shadow-only style —
                // mirrors the sibling search chip below, which was already fixed.
                className="w-10 h-10 rounded-full bg-surface items-center justify-center"
                style={({ pressed }) => [hs.floatingChipShadow, pressed && hs.chipPressed]}
              >
                <Avatar uri={user?.avatar_url} name={user?.full_name} size="sm" />
              </Pressable>
              {/* Premium greeting — elegant white type directly on the hero
                  (no pill chrome): a light eyebrow over the bold first name,
                  the way ride-hailing homes greet you by name. */}
              <View className="flex-1 ml-3" pointerEvents="none">
                <Text
                  className="text-[12px] font-montserrat-semi"
                  style={{ color: 'rgba(255,255,255,0.82)', letterSpacing: 0.3 }}
                  numberOfLines={1}
                >
                  {greeting}
                </Text>
                <Text
                  className="text-[19px] font-montserrat-bold"
                  style={{ color: '#FFFFFF' }}
                  numberOfLines={1}
                >
                  {firstName}
                </Text>
              </View>
              {/* Notifications live in the bottom "Alerts" tab, so the header
                  keeps a single search affordance and stays calm + premium. */}
              <Pressable
                hitSlop={8}
                onPress={withLightImpact(() => router.push('/(customer)/search' as any))}
                accessibilityRole="button"
                accessibilityLabel="Search"
                className="w-10 h-10 rounded-full bg-surface items-center justify-center"
                style={({ pressed }) => [hs.floatingChipShadow, pressed && hs.chipPressed]}
              >
                <Search size={20} color={LightColors.ink} strokeWidth={1.9} />
              </Pressable>
            </View>
          </SafeAreaView>
        </View>

        {/* Destination card — floats up over the SOLID blue of the hero (not
            its faded edge) so the rounded top corners show blue behind them
            and the radius actually reads. */}
        <View className="px-5" style={{ marginTop: -32 }}>
          <Pressable
            onPress={withLightImpact(() => startBooking())}
            accessibilityRole="button"
            accessibilityLabel="Start a new booking"
            className="bg-surface px-4 py-4 rounded-[28px] border border-divider"
            android_ripple={{ color: 'rgba(37,99,235,0.08)' }}
            style={({ pressed }) => [hs.searchBox, pressed && hs.cardPressed]}
          >
            <View className="flex-row items-center">
              <View style={hs.pickupRing}>
                <View style={hs.pickupDot} />
              </View>
              <Text className="ml-3 text-[14px] font-montserrat text-textSecondary flex-1">
                Pickup location
              </Text>
            </View>
            {/* Connector */}
            <View
              style={{
                marginLeft: 7,
                width: 2,
                height: 14,
                backgroundColor: LightColors.divider,
              }}
            />
            <View className="flex-row items-center">
              {/* Drop-off square */}
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  backgroundColor: LightColors.textPrimary,
                  marginLeft: 4,
                }}
              />
              <Text className="ml-3 text-[15px] font-montserrat-bold text-textPrimary flex-1">
                What can we help you with today?
              </Text>
              {/* Signature chevron bubble — same gesture used on the
                  primary CTA, tying the destination prompt to the
                  app's primary forward-action vocabulary. */}
              <View style={hs.chevronBubble}>
                <ArrowRight
                  size={16}
                  color={LightColors.textInverse}
                  strokeWidth={2.4}
                />
              </View>
            </View>
          </Pressable>
        </View>

        {/* Continue your errand — a resume card for an abandoned mid-flow
            draft. Sits directly under the destination prompt so it's the
            first thing a returning user sees. Tapping it deep-links back
            into the correct step WITHOUT clearing the draft; the X dismisses
            it for the session only (the draft itself survives). */}
        {resumeInfo && (
          <View className="px-5 mt-4">
            <View
              className="flex-row items-center bg-surface rounded-2xl border border-primary100 py-3 pl-3 pr-2"
              style={hs.resumeCard}
            >
              <Pressable
                onPress={withLightImpact(resumeBooking)}
                android_ripple={{ color: 'rgba(37,99,235,0.08)' }}
                className="flex-1 flex-row items-center"
                accessibilityRole="button"
                accessibilityLabel={`Continue your ${resumeInfo.typeName} errand, step ${resumeInfo.stepNumber} of 4`}
                accessibilityHint="Returns to where you left off in the booking"
                style={({ pressed }) => pressed && hs.cardPressed}
              >
                {resumeInfo.iconName ? (
                  <ErrandTypeIcon
                    name={resumeInfo.iconName}
                    size="xs"
                    variant="tinted"
                  />
                ) : (
                  <View className="w-9 h-9 rounded-full bg-surfaceMuted items-center justify-center">
                    <Clock size={17} color={LightColors.primary} strokeWidth={2} />
                  </View>
                )}
                <View className="flex-1 ml-3 pr-2">
                  <Text
                    className="text-[13.5px] font-montserrat-bold text-textPrimary"
                    numberOfLines={1}
                  >
                    Continue your errand
                  </Text>
                  <Text
                    className="text-[11.5px] font-montserrat text-textSecondary mt-0.5"
                    numberOfLines={1}
                  >
                    {resumeInfo.typeName} · Step {resumeInfo.stepNumber} of 4
                  </Text>
                </View>
                <ChevronRight
                  size={18}
                  color={LightColors.textMuted}
                  strokeWidth={2.2}
                />
              </Pressable>
              <Pressable
                onPress={withLightImpact(() => setResumeDismissed(true))}
                hitSlop={10}
                className="w-8 h-8 items-center justify-center ml-1"
                accessibilityRole="button"
                accessibilityLabel="Dismiss continue errand"
                style={({ pressed }) => pressed && { opacity: 0.5 }}
              >
                <X size={16} color={LightColors.textMuted} strokeWidth={2} />
              </Pressable>
            </View>
          </View>
        )}

        {/* Active errand(s) — promoted directly under the destination card
            (above the pills) so the user's live errand wins the first
            viewport. More than one errand is genuinely common (a live errand
            plus one booked for later), and every one but the top of the
            ranking used to be invisible here, so the section becomes a paged
            stack once there are two — capped at 3, the same cap the server
            puts on `active_bookings`. */}
        {activeCards.length > 0 && (
          <View className="mx-5 mt-4" style={hs.activeZone}>
            <Eyebrow className="ml-1 mb-2" color={LightColors.primary}>
              {activeEyebrow}
            </Eyebrow>
            {activeCards.length === 1 ? (
              renderActiveCard(activeCards[0])
            ) : (
              <>
                <ScrollView
                  horizontal
                  testID="active-errand-pager"
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToInterval={activeCardStride}
                  snapToAlignment="start"
                  disableIntervalMomentum
                  // flex-start, not the default stretch: a short "booked for
                  // later" card next to a tall live one must keep its own
                  // height instead of becoming a tall box with content
                  // stranded at the top.
                  contentContainerStyle={{ alignItems: 'flex-start' }}
                  onMomentumScrollEnd={(e) => {
                    setActiveCardIndex(
                      Math.round(e.nativeEvent.contentOffset.x / activeCardStride),
                    );
                  }}
                >
                  {activeCards.map((booking, i) => (
                    <View
                      key={booking.id}
                      style={{
                        width: activeCardWidth,
                        marginRight:
                          i === activeCards.length - 1 ? 0 : ACTIVE_CARD_GAP,
                      }}
                    >
                      {renderActiveCard(booking)}
                    </View>
                  ))}
                </ScrollView>
                {/* Page dots — a visual cue only. The count is already spoken
                    by the section eyebrow and each card carries its own label,
                    so these stay out of the accessibility tree. */}
                <View
                  className="flex-row items-center justify-center mt-2.5"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {activeCards.map((booking, i) => (
                    <View
                      key={booking.id}
                      style={[
                        hs.activeDot,
                        i === activeCardIndex && hs.activeDotOn,
                      ]}
                    />
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {/* Quick actions — 3–4 compact pills for the highest-frequency
            jumps (repeat, schedule, help). Horizontally scrollable so
            tight screens never wrap or clip. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
        >
          {quickActions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <Pressable
                key={action.key}
                onPress={withLightImpact(action.onPress)}
                android_ripple={{ color: 'rgba(37,99,235,0.08)' }}
                // Layout via className (NativeWind drops flexDirection/bg from
                // the function-style form). Toned down to read subtle: no
                // border, just a soft borderless pill with a gentle lift.
                className="flex-row items-center h-11 rounded-xl bg-surface pl-2 pr-3.5"
                style={({ pressed }) => [hs.quickActionShadow, pressed && hs.cardPressed]}
                hitSlop={{ top: 4, bottom: 4 }}
                accessibilityRole="button"
                accessibilityLabel={action.a11yLabel}
              >
                {/* Softer icon chip — neutral surfaceMuted fill + slate icon
                    (was a brand-blue fill on light-blue) so the accent is
                    quiet rather than loud. */}
                <View style={hs.quickActionIcon}>
                  <ActionIcon
                    size={15}
                    color={LightColors.textSecondary}
                    strokeWidth={2}
                  />
                </View>
                {/* Lighter weight + muted colour so the label reads subtle;
                    numberOfLines={1} keeps it inline beside the icon chip. */}
                <Text
                  className="ml-2 text-[12.5px] font-montserrat-semi text-textSecondary"
                  numberOfLines={1}
                >
                  {action.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Rewards band — self-collapsing. Sits between the quick-action pills
            and the service grid, surfacing promos / wallet credit / an invite
            teaser the user already holds. Renders NOTHING when there's nothing
            to show; amber reward pills (accentSoft) with a blue chevron CTA
            distinguish it from the neutral quick actions above. */}
        {rewardItems.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-2.5"
            contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
          >
            {rewardItems.map((item) => {
              const RewardIcon = item.icon;
              return (
                <Pressable
                  key={item.key}
                  onPress={withLightImpact(item.onPress)}
                  android_ripple={{ color: 'rgba(245,158,11,0.12)' }}
                  // Layout via className (NativeWind drops flexDirection/bg from
                  // the function-style form) — bg-accentSoft is the reward wash.
                  className="flex-row items-center h-11 rounded-xl bg-accentSoft pl-2 pr-2.5"
                  style={({ pressed }) => [hs.rewardShadow, pressed && hs.cardPressed]}
                  hitSlop={{ top: 4, bottom: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={item.a11yLabel}
                >
                  {/* White chip so the amber glyph pops off the amber wash. */}
                  <View style={hs.rewardIcon}>
                    <RewardIcon
                      size={15}
                      color={LightColors.accentStrong}
                      strokeWidth={2}
                    />
                  </View>
                  <Text
                    className="ml-2 text-[12.5px] font-montserrat-bold text-accentDark"
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  {/* Blue forward-action affordance — the CTA vocabulary. */}
                  <ChevronRight
                    size={16}
                    color={LightColors.primary}
                    strokeWidth={2.4}
                    style={{ marginLeft: 6 }}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Service tiles — a small set of the most common errand
            types. Soft surface tiles with a tinted-blue icon chip and
            dark label — less dominant blue than full brand-fill. When
            the fetch fails with nothing cached, an inline compact error
            takes the section's place instead of it silently vanishing. */}
        {(featuredTypes.length > 0 || errandTypesQ.error) && (
          <View className="mt-7 px-5">
            <View className="flex-row items-baseline justify-between mb-3">
              <Text className="text-[15px] font-montserrat-bold text-textPrimary">
                What can we help with?
              </Text>
              {featuredTypes.length > 0 && (
                <Pressable
                  onPress={() => startBooking()}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  accessibilityRole="button"
                  accessibilityLabel="See all errand types"
                  style={({ pressed }) => pressed && { opacity: 0.5 }}
                >
                  <Text className="text-[11px] font-montserrat-bold text-primary underline">
                    See all
                  </Text>
                </Pressable>
              )}
            </View>
            {featuredTypes.length === 0 ? (
              <ErrorState
                compact
                title="Couldn't load services"
                onRetry={() => {
                  errandTypesQ.refresh();
                }}
              />
            ) : (
              <>
                {frequentType && (
                  <Pressable
                    onPress={withLightImpact(() =>
                      repeatFrom(frequentSource, frequentType.id),
                    )}
                    style={({ pressed }) => [
                      hs.frequentChip,
                      pressed && hs.cardPressed,
                    ]}
                    hitSlop={{ top: 8, bottom: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Frequently booked: start a ${frequentType.name} errand`}
                    className="mb-3 self-start flex-row items-center bg-accentSoft"
                  >
                    <TrendingUp
                      size={13}
                      color={LightColors.accentStrong}
                      strokeWidth={2.2}
                    />
                    <Text className="ml-1.5 text-[11px] font-montserrat-bold text-accentDark">
                      Frequently booked · {frequentType.name}
                    </Text>
                  </Pressable>
                )}
                <View className="flex-row flex-wrap -mx-1.5">
              {featuredTypes.map((type) => {
                const Icon = ICON_MAP[type.icon_name] ?? Package;
                return (
                  <View key={type.id} style={{ width: '25%' }} className="px-1.5">
                    <Pressable
                      onPress={withLightImpact(() => startBooking(type.id))}
                      // White card + border + layout via className. NativeWind
                      // drops backgroundColor/flex props from the function-style
                      // form, which is why the tile rendered with NO fill no
                      // matter what colour hs.serviceTile set. Only the shadow
                      // (a pass-through prop) stays in the style prop.
                      className="items-center justify-center py-4 px-1 bg-surface rounded-2xl border border-primary100 min-h-[100px]"
                      android_ripple={{ color: 'rgba(37,99,235,0.08)' }}
                      style={({ pressed }) => [hs.serviceTileShadow, pressed && hs.cardPressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Start a ${type.name} errand`}
                    >
                      {type.icon_name ? (
                        <ErrandTypeIcon
                          name={type.icon_name}
                          size="sm"
                          variant="tinted"
                        />
                      ) : (
                        <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
                          <Icon
                            size={20}
                            color={LightColors.primary}
                            strokeWidth={2}
                          />
                        </View>
                      )}
                      <Text
                        className="text-[11px] font-montserrat-semi text-textPrimary text-center mt-2"
                        numberOfLines={2}
                        // Reserved two-line box so multi-word names wrap
                        // instead of truncating and rows stay even.
                        style={{ lineHeight: 14, minHeight: 28 }}
                      >
                        {type.name}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
                </View>
              </>
            )}
          </View>
        )}

        {/* Recent — at most 3 rows, no card chrome, single inline
            section label with "See all" link to its right. */}
        {recentBookings.length > 0 ? (
          <View className="px-5 mt-7">
            <View className="flex-row items-baseline justify-between mb-2">
              <Eyebrow>Recent</Eyebrow>
              <Pressable
                onPress={() => router.push('/(customer)/(tabs)/activity')}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                accessibilityRole="button"
                accessibilityLabel="See all errands"
                style={({ pressed }) => pressed && { opacity: 0.5 }}
              >
                <Text className="text-[11px] font-montserrat-bold text-primary underline">
                  See all
                </Text>
              </Pressable>
            </View>
            {recentBookings.map((booking) => {
              const statusColor =
                STATUS_COLORS[booking.status] ?? LightColors.textMuted;
              return (
                <Pressable
                  key={booking.id}
                  // Soft white card per errand (was an edge-to-edge hairline
                  // row) — a leading errand-type glyph, the name + status/time,
                  // and the fare, lifted on a subtle shadow so each errand
                  // reads as its own surface with clear depth.
                  className="flex-row items-center bg-surface rounded-2xl p-3 mb-2.5"
                  android_ripple={{ color: 'rgba(37,99,235,0.08)' }}
                  style={({ pressed }) => [hs.recentCard, pressed && hs.cardPressed]}
                  onPress={withLightImpact(() => setSelectedBooking(booking))}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${booking.errand_type?.name ?? 'errand'} from ${formatRelativeTime(booking.created_at)}`}
                >
                  {booking.errand_type?.icon_name ? (
                    <ErrandTypeIcon
                      name={booking.errand_type.icon_name}
                      size="xs"
                      variant="tinted"
                    />
                  ) : (
                    <View className="w-9 h-9 rounded-full bg-surfaceMuted items-center justify-center">
                      <Package size={18} color={LightColors.primary} strokeWidth={2} />
                    </View>
                  )}
                  <View className="flex-1 pr-3 ml-3">
                    <Text
                      className="text-[14px] font-montserrat-bold text-textPrimary"
                      numberOfLines={1}
                    >
                      {booking.errand_type?.name ?? 'Errand'}
                    </Text>
                    <View className="flex-row items-center mt-1">
                      <View
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 2.5,
                          backgroundColor: statusColor,
                          marginRight: 6,
                        }}
                      />
                      <Text
                        className="text-[11px] font-montserrat text-textSecondary"
                        numberOfLines={1}
                      >
                        {STATUS_LABELS[booking.status] ?? booking.status}
                        {' · '}
                        {formatRelativeTime(booking.created_at)}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-[14px] font-inter-semi text-textPrimary">
                    {formatCurrency(booking.total_amount)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : recentBookingsQ.error ? (
          // Fetch failed and nothing cached — say so instead of the
          // section silently disappearing.
          <View className="px-5 mt-7">
            <Eyebrow className="mb-2">Recent</Eyebrow>
            <ErrorState
              compact
              title="Couldn't load your errands"
              onRetry={() => {
                recentBookingsQ.refresh();
              }}
            />
          </View>
        ) : !recentBookingsQ.loading && enabled && !!user?.id ? (
          // Genuinely empty (loaded fine, zero bookings) — guide the
          // first booking instead of hiding the section.
          <View className="px-5 mt-7">
            <Eyebrow className="mb-2">Recent</Eyebrow>
            <Text className="text-[13px] font-montserrat text-textSecondary leading-5">
              Your errands will show up here.{'\n'}Book one and track everything
              from this screen.
            </Text>
            <Pressable
              onPress={withLightImpact(() => startBooking())}
              className="flex-row items-center mt-3 self-start"
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Book your first errand"
              style={({ pressed }) => pressed && { opacity: 0.5 }}
            >
              <Text className="text-[12px] font-montserrat-bold text-primary underline mr-1">
                Book your first errand
              </Text>
              <ArrowRight
                size={13}
                color={LightColors.primary}
                strokeWidth={2.4}
              />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/* Same detail sheet Activity uses — recent-row tap parity. */}
      <BookingDetailSheet
        booking={selectedBooking}
        isVisible={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
      />
    </View>
  );
}

/**
 * A booking made for LATER, still outside its matching window. Rendered
 * instead of ActiveBookingCard so a `pending` scheduled errand doesn't sit
 * under a pulsing dot claiming we're "looking for a runner nearby" for days.
 *
 * Extracted from the home render so the paged stack can decide per card —
 * a customer can easily hold one live errand and one booked for tomorrow.
 */
function ScheduledErrandCard({
  booking,
  label,
  onPress,
}: {
  booking: Booking;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Scheduled errand: ${
        booking.errand_type?.name ?? 'Errand'
      } on ${label}. Tap to view details.`}
      android_ripple={{ color: 'rgba(37,99,235,0.08)' }}
      // Layout / fill / radius via className — NativeWind drops
      // those from the style-function form.
      className="bg-surface rounded-2xl p-4"
      style={({ pressed }) => [hs.recentCard, pressed && hs.cardPressed]}
    >
      <View className="flex-row items-center">
        <View style={hs.scheduledIcon}>
          <CalendarClock size={15} color={LightColors.primary} strokeWidth={2} />
        </View>
        <Text
          className="flex-1 ml-2.5 text-[12px] font-montserrat-bold text-textSecondary"
          numberOfLines={1}
        >
          {booking.errand_type?.name ?? 'Errand'}
        </Text>
        <Text className="text-[14px] font-inter-semi text-textPrimary">
          {formatCurrency(booking.total_amount)}
        </Text>
      </View>
      <Text
        className="text-[16px] font-montserrat-bold text-textPrimary mt-2.5"
        numberOfLines={2}
      >
        {label}
      </Text>
      <Text className="text-[12px] font-montserrat text-textSecondary mt-1 leading-[17px]">
        We&apos;ll start looking for a runner about{' '}
        {SCHEDULED_MATCH_LEAD_MINUTES} minutes before.
      </Text>
      <View className="flex-row items-center mt-3 pt-3" style={hs.scheduledFooter}>
        <Text className="flex-1 text-[12px] font-montserrat-semi text-primary">
          View details
        </Text>
        <ChevronRight size={16} color={LightColors.primary} strokeWidth={2.2} />
      </View>
    </Pressable>
  );
}

const hs = StyleSheet.create({
  // Height is responsive (clamped to viewport, shrunk when an errand is
  // live) — applied inline in the render.
  mapHero: {
    backgroundColor: LightColors.divider,
    overflow: 'hidden',
  },
  mapFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Tiny fade — just softens the hero's very bottom edge in the gaps beside
    // the card. Kept short so the card's rounded top corners sit over SOLID
    // blue (visible radius), not a near-white wash.
    height: 12,
  },
  // Waving mascot in the hero's bottom-right corner. Height/width/bottom are
  // all set inline (responsive to the hero height): a negative bottom pushes
  // the legs off the hero's clipped edge so only the upper body shows. right:20
  // keeps it within the card's horizontal margin so the card fully covers the
  // cropped-off lower half.
  mascotWrap: {
    position: 'absolute',
    right: 20,
  },
  // White floating chrome chips over the map — avatar, greeting, bell.
  floatingChip: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: LightColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Elevation.md,
  },
  // Shadow-only companion for chips whose box + fill are set via className
  // (the search / bell chips) — NativeWind drops bg/size from function
  // styles, but the shadow (a pass-through prop) still applies here.
  floatingChipShadow: {
    ...Elevation.md,
  },
  greetingPill: {
    flex: 0,
    // Shrink (and truncate via numberOfLines) before pushing the
    // search/bell chips off the right edge on long names.
    flexShrink: 1,
    marginHorizontal: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginRight: 'auto',
  },
  // Pressed states — same idiom as ActiveBookingCard. Chips are small
  // round targets so they get a slightly deeper scale; cards/pills/tiles
  // get the subtle lift-release. Opacity/scale only, so layout bounds
  // stay stable.
  chipPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.96 }],
  },
  cardPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.99 }],
  },
  // Numeric unread badge on the bell chip.
  bellBadge: {
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: LightColors.surface,
  },
  bellBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: LightColors.textInverse,
  },
  searchBox: {
    // Radius + hairline border live in className now (NativeWind reliably
    // applies them there; from this Pressable's function-style form it was
    // DROPPING the radius, so the card rendered square). Only the shadow — a
    // pass-through prop NativeWind keeps — stays here.
    ...Elevation.md,
  },
  pickupRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: LightColors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: LightColors.success,
  },
  chevronBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: LightColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Soft lift for the white service-card. Its layout (bg-surface, border,
  // radius, min-height, centring) lives in className — see the note on the
  // Pressable; only the shadow is applied via the style prop. Elevation.md
  // (a touch stronger than sm) so the white card reads clearly against the
  // near-white page instead of blending in.
  serviceTileShadow: {
    // minHeight duplicated from className as a safe fallback (a pass-through
    // prop, unlike bg/flex which NativeWind drops from function styles).
    minHeight: 100,
    ...Elevation.md,
  },
  // Soft lift for the quick-action pills. Their layout (flex-row, bg,
  // border, radius, padding, height) lives in className now — see the note
  // on the Pressable; only the shadow is applied via the style prop.
  quickActionShadow: {
    ...Elevation.sm,
  },
  quickActionIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    // Neutral soft-grey chip (was brand-blue) so the icon reads as a quiet
    // affordance rather than a loud coloured badge.
    backgroundColor: LightColors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rewards-band pills — shadow only; bg-accentSoft / radius / layout live in
  // className (NativeWind drops bg from the style-function form).
  rewardShadow: {
    ...Elevation.sm,
  },
  // White icon chip inside a reward pill so the amber glyph reads clearly
  // against the accentSoft wash.
  rewardIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: LightColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // "Frequently booked" personalization chip above the service tiles.
  frequentChip: {
    borderRadius: 999,
    // Gold "Guy" personalization chip — bg-accentSoft lives in className
    // (NativeWind drops backgroundColor from the style-function form), so
    // only radius / padding stay here.
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  // Soft tinted "zone" behind the active errand — a light-blue wash with a
  // hairline so the live errand reads as its own band. The white
  // ActiveBookingCard floats inside it on its own shadow.
  activeZone: {
    backgroundColor: LightColors.primary50,
    borderRadius: 24,
    padding: 12,
    borderWidth: 1,
    borderColor: LightColors.primary100,
  },
  // Recent errand card — subtle lift so each errand reads as its own
  // surface. Radius / bg / layout live in className; only the shadow (a
  // pass-through prop NativeWind keeps) is applied here.
  recentCard: {
    ...Elevation.sm,
  },
  // Calendar glyph chip on the "booked for later" card.
  scheduledIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Page dots under the paged active-errand stack.
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 3,
    backgroundColor: LightColors.primary100,
  },
  activeDotOn: {
    backgroundColor: LightColors.primary,
  },
  // Hairline above the card's "View details" row.
  scheduledFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LightColors.divider,
  },
  // "Continue your errand" resume card — subtle lift matching the recent
  // rows. bg / radius / border / layout live in className; only the
  // shadow (a pass-through prop NativeWind keeps) is applied here.
  resumeCard: {
    ...Elevation.sm,
  },
});
