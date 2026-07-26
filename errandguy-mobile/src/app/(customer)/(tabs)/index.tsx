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
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore } from '../../../stores/bookingStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { bookingService } from '../../../services/booking.service';
import { warmTracking } from '../../../services/preload.service';
import { configService } from '../../../services/config.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';
import { Avatar } from '../../../components/ui/Avatar';
import { ActiveBookingCard } from '../../../components/customer/ActiveBookingCard';
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

const ICON_MAP: Record<string, LucideIcon> = {
  Package,
};

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
  const { height: winHeight } = useResponsive();
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

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

  const errandTypes = (errandTypesQ.data ?? []).filter((t) => t.is_active);
  // Keep the home dashboard simple — surface only the most common
  // errand types here. The full list lives one tap deeper on the
  // booking type screen ("See all").
  const featuredTypes = errandTypes.slice(0, 4);
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

  const [refreshing, setRefreshing] = useState(false);
  // Recent rows open the same detail sheet Activity uses — tap parity
  // between the two lists (tracking stays one tap deeper, via the sheet
  // or the ActiveBookingCard).
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      errandTypesQ.refresh(),
      recentBookingsQ.refresh(),
      activeBookingQ.refresh(),
    ]);
    setRefreshing(false);
  }, [errandTypesQ, recentBookingsQ, activeBookingQ]);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  const startBooking = useCallback(
    (preselectedTypeId?: string) => {
      clearDraft();
      router.push(
        preselectedTypeId
          ? {
              pathname: '/(customer)/book/type',
              params: { preselected: preselectedTypeId },
            }
          : '/(customer)/book/type',
      );
    },
    [clearDraft, router],
  );

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

  // Quick actions — compact pills under the destination card.
  // Contextual: "Repeat last" only when there's a recent booking. No
  // "Track" pill — when an errand is live the ActiveBookingCard renders
  // directly above these pills, so a pill would duplicate it.
  const lastBooking = recentBookings[0];
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
            a11yLabel: `Repeat your last ${lastBooking.errand_type?.name ?? 'errand'} booking`,
            onPress: () => startBooking(lastBooking.errand_type_id),
          },
        ]
      : []),
    {
      key: 'schedule',
      label: 'Schedule',
      icon: CalendarClock,
      a11yLabel: 'Schedule an errand for later',
      onPress: () => startBooking(),
    },
    {
      key: 'help',
      label: 'Help',
      icon: LifeBuoy,
      a11yLabel: 'Open the help center',
      onPress: () => router.push('/(customer)/help' as any),
    },
  ];

  // Decorative hero: clamp to ~36% of the viewport so SE-class phones
  // and landscape don't drown in gradient, and shrink further when a
  // live errand needs to win the first viewport.
  const heroHeight = Math.min(
    activeBooking ? 220 : 300,
    Math.round(winHeight * 0.36),
  );

  // Waving delivery mascot peeking from behind the destination card in the
  // hero's bottom-right. Only its UPPER body (head, waving arm, torso) is
  // meant to show — the legs/feet are deliberately cut off below the card's
  // top edge and the hero's clipped bottom. So we pick a LARGE intrinsic
  // size and anchor it with a negative bottom offset so roughly
  // MASCOT_VISIBLE_FRACTION of it sits above the card; the rest runs off the
  // bottom (behind the card / clipped by the hero's overflow). Height is
  // capped both by width (so the big figure still reads as a corner accent)
  // and by the chrome band above (so the head never collides with it).
  const MASCOT_CARD_OVERLAP = 44; // destination card floats up this far
  const MASCOT_VISIBLE_FRACTION = 0.44; // top ~44% shown (head → torso)
  const mascotMaxByChrome =
    (heroHeight - MASCOT_CARD_OVERLAP - (insets.top + 60)) /
    MASCOT_VISIBLE_FRACTION;
  const mascotHeight = Math.min(240, mascotMaxByChrome);
  const mascotWidth = mascotHeight * 0.5; // intrinsic aspect ~0.5 (w/h)
  const mascotBottom =
    MASCOT_CARD_OVERLAP - (1 - MASCOT_VISIBLE_FRACTION) * mascotHeight;
  const showMascot = mascotHeight >= 110;

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
          {/* Waving mascot — decorative, so it never intercepts touches
              (the hero tap-target below still starts a booking anywhere on
              the gradient). Anchored bottom-right so its raised hand points
              back toward the greeting; feet rest just above the destination
              card that floats up over the hero's lower edge. */}
          {showMascot && (
            <View
              pointerEvents="none"
              style={[
                hs.mascotWrap,
                { height: mascotHeight, width: mascotWidth, bottom: mascotBottom },
              ]}
            >
              <Image
                source={require('../../../../assets/mascot-home.png')}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={200}
                accessibilityIgnoresInvertColors
              />
            </View>
          )}
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
                style={({ pressed }) => [hs.floatingChip, pressed && hs.chipPressed]}
              >
                <Avatar uri={user?.avatar_url} name={user?.full_name} size="sm" />
              </Pressable>
              <View style={[hs.floatingChip, hs.greetingPill]} pointerEvents="none">
                <Text
                  className="text-[12px] font-montserrat-bold text-textPrimary"
                  numberOfLines={1}
                >
                  {greeting}, {firstName}
                </Text>
              </View>
              {/* Box/size/bg via className — NativeWind drops backgroundColor
                  + minWidth from the function-style form, which collapsed
                  these to bare icons sitting ~14px apart (the "too close"
                  report). className restores the white chip; mr-5 (20px) gives
                  a clear gap to the bell. */}
              <Pressable
                hitSlop={8}
                onPress={withLightImpact(() => router.push('/(customer)/search' as any))}
                accessibilityRole="button"
                accessibilityLabel="Search"
                className="w-10 h-10 rounded-full bg-surface items-center justify-center mr-5"
                style={({ pressed }) => [hs.floatingChipShadow, pressed && hs.chipPressed]}
              >
                <Search size={20} color={LightColors.ink} strokeWidth={1.9} />
              </Pressable>
              <Pressable
                hitSlop={8}
                onPress={withLightImpact(() =>
                  router.push('/(customer)/(tabs)/notifications'),
                )}
                accessibilityRole="button"
                accessibilityLabel={
                  unreadCount > 0
                    ? `${unreadCount} unread notifications`
                    : 'Notifications'
                }
                className="w-10 h-10 rounded-full bg-surface items-center justify-center"
                style={({ pressed }) => [hs.floatingChipShadow, pressed && hs.chipPressed]}
              >
                <Bell size={20} color={LightColors.ink} strokeWidth={1.9} />
                {unreadCount > 0 && (
                  <View
                    className="absolute bg-danger items-center justify-center"
                    style={hs.bellBadge}
                  >
                    <Text style={hs.bellBadgeText} allowFontScaling={false}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        </View>

        {/* Destination card — floats up over the map's faded edge. */}
        <View className="px-5" style={{ marginTop: -44 }}>
          <Pressable
            onPress={withLightImpact(() => startBooking())}
            accessibilityRole="button"
            accessibilityLabel="Start a new booking"
            className="bg-surface px-4 py-4"
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

        {/* Active errand — promoted directly under the destination card
            (above the pills) so the user's live errand wins the first
            viewport. No eyebrow needed: the card itself communicates the
            live state via its progress track and headline. */}
        {activeBooking && (
          <View className="mx-5 mt-3">
            <ActiveBookingCard
              booking={activeBooking}
              onPress={() => {
                // Warm the tracking fetch on the same tap so the screen's mount
                // GET coalesces (activeBooking is already the store value, so
                // the paint is instant regardless). (P2)
                warmTracking(activeBooking);
                router.push(`/(customer)/tracking/${activeBooking.id}`);
              }}
            />
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
                    onPress={withLightImpact(() => startBooking(frequentType.id))}
                    style={({ pressed }) => [
                      hs.frequentChip,
                      pressed && hs.cardPressed,
                    ]}
                    hitSlop={{ top: 8, bottom: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Frequently booked: start a ${frequentType.name} errand`}
                    className="mb-3 self-start flex-row items-center"
                  >
                    <TrendingUp
                      size={13}
                      color={LightColors.primary}
                      strokeWidth={2.2}
                    />
                    <Text className="ml-1.5 text-[11px] font-montserrat-bold text-primary">
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
                        <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center">
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
            {recentBookings.map((booking, idx) => {
              const statusColor =
                STATUS_COLORS[booking.status] ?? LightColors.textMuted;
              return (
                <Pressable
                  key={booking.id}
                  className="flex-row items-center py-3.5"
                  // Edge-to-edge row: background wash on press, no scale.
                  style={({ pressed }) => [
                    idx < recentBookings.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: LightColors.divider,
                    },
                    pressed && { backgroundColor: LightColors.surfaceMuted },
                  ]}
                  onPress={withLightImpact(() => setSelectedBooking(booking))}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${booking.errand_type?.name ?? 'errand'} from ${formatRelativeTime(booking.created_at)}`}
                >
                  <View className="flex-1 pr-3">
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
                      <Text className="text-[11px] font-montserrat text-textSecondary">
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
    height: 110,
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
    // Clearly rounded card (per request) with a subtle hairline border on
    // top of the soft lift, so it has a crisp, defined edge where it floats
    // over the gradient/canvas seam.
    borderRadius: 22,
    borderWidth: 1,
    borderColor: LightColors.divider,
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
  // "Frequently booked" personalization chip above the service tiles.
  frequentChip: {
    borderRadius: 999,
    backgroundColor: LightColors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
