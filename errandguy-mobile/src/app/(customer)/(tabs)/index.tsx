import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Package,
  Bell,
  ArrowRight,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore } from '../../../stores/bookingStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { bookingService } from '../../../services/booking.service';
import { configService } from '../../../services/config.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';
import { Avatar } from '../../../components/ui/Avatar';
import { ActiveBookingCard } from '../../../components/customer/ActiveBookingCard';
import { ErrandTypeIcon } from '../../../components/ui/ErrandTypeIcon';
import { HomeSkeleton } from '../../../components/ui/Skeleton';
import { STATUS_LABELS, STATUS_COLORS } from '../../../constants/statusLabels';
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
      const res = await bookingService.getBookings({ per_page: 3 });
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

  if (initialLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <HomeSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <StatusBar barStyle="light-content" />
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        // Reserve room at the bottom so the floating QuickBookFAB
        // never covers the last row (the previous 32pt left the FAB
        // disc sitting on top of the price text).
        contentContainerStyle={{ paddingBottom: TAB_CONTENT_BOTTOM_INSET }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFFFFF"
            colors={['#2563EB']}
          />
        }
      >
        {/* Brand-color header band — gives the home screen real
            colour presence and visual depth. The hero destination
            card floats up over the bottom edge of the gradient so it
            reads as the primary surface. */}
        <LinearGradient
          colors={['#1D4ED8', '#2563EB', '#3B82F6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={hs.headerGradient}
        >
          <SafeAreaView edges={['top']}>
            <View className="flex-row items-center px-5 pt-2 pb-3">
              <Pressable
                onPress={() => router.push('/(customer)/(tabs)/profile')}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Open profile"
              >
                <Avatar uri={user?.avatar_url} name={user?.full_name} size="sm" />
              </Pressable>
              <View className="flex-1 ml-3">
                <Text className="text-[11px] font-montserrat" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  {greeting}
                </Text>
                <Text
                  className="text-[14px] font-montserrat-bold text-white"
                  numberOfLines={1}
                >
                  {firstName}
                </Text>
              </View>
              <Pressable
                className="relative w-10 h-10 items-center justify-center"
                hitSlop={8}
                onPress={() => router.push('/(customer)/(tabs)/notifications')}
                accessibilityRole="button"
                accessibilityLabel={
                  unreadCount > 0
                    ? `${unreadCount} unread notifications`
                    : 'Notifications'
                }
              >
                <Bell size={22} color="#FFFFFF" strokeWidth={1.8} />
                {unreadCount > 0 && (
                  <View
                    className="absolute"
                    style={{
                      top: 8,
                      right: 8,
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: '#F87171',
                      borderWidth: 1.5,
                      borderColor: '#1D4ED8',
                    }}
                  />
                )}
              </Pressable>
            </View>

            {/* Hero copy on the gradient — white text for contrast.
                Bottom padding leaves clear room for the destination
                card to float up without crowding the subtitle. */}
            <View className="px-5 pt-1 pb-10">
              <Text
                className="text-[24px] font-montserrat-bold text-white"
                style={{ lineHeight: 28, letterSpacing: -0.3 }}
              >
                Where to?
              </Text>
              <Text
                className="text-[13px] font-montserrat mt-1.5"
                style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 18 }}
              >
                Tap below to start a new errand.
              </Text>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Destination card — floats up over the gradient bottom edge. */}
        <View className="px-5" style={{ marginTop: -14 }}>
          <Pressable
            onPress={() => startBooking()}
            accessibilityRole="button"
            accessibilityLabel="Start a new booking"
            className="bg-white px-4 py-4"
            style={hs.searchBox}
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
                backgroundColor: '#E2E8F0',
              }}
            />
            <View className="flex-row items-center">
              {/* Drop-off square */}
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  backgroundColor: '#0F172A',
                  marginLeft: 4,
                }}
              />
              <Text className="ml-3 text-[14px] font-montserrat-bold text-textPrimary flex-1">
                Where to?
              </Text>
              {/* Signature chevron bubble — same gesture used on the
                  primary CTA, tying the destination prompt to the
                  app's primary forward-action vocabulary. */}
              <View style={hs.chevronBubble}>
                <ArrowRight size={16} color="#FFFFFF" strokeWidth={2.4} />
              </View>
            </View>
          </Pressable>
        </View>

        {/* Active errand — only when present, no eyebrow needed (the
            card itself communicates the live state via its progress
            track and headline). */}
        {activeBooking && (
          <View className="mx-5 mt-4">
            <ActiveBookingCard
              booking={activeBooking}
              onPress={() =>
                router.push(`/(customer)/tracking/${activeBooking.id}`)
              }
            />
          </View>
        )}

        {/* Service tiles — a small set of the most common errand
            types. Soft surface tiles with a tinted-blue icon chip and
            dark label — less dominant blue than full brand-fill. */}
        {featuredTypes.length > 0 && (
          <View className="mt-7 px-5">
            <View className="flex-row items-baseline justify-between mb-3">
              <Text className="text-[15px] font-montserrat-bold text-textPrimary">
                What can we help with?
              </Text>
              <Pressable
                onPress={() => startBooking()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="See all errand types"
              >
                <Text className="text-[11px] font-montserrat-bold text-primary underline">
                  See all
                </Text>
              </Pressable>
            </View>
            <View className="flex-row flex-wrap -mx-1.5">
              {featuredTypes.map((type) => {
                const Icon = ICON_MAP[type.icon_name] ?? Package;
                return (
                  <View key={type.id} style={{ width: '25%' }} className="px-1.5">
                    <Pressable
                      onPress={() => startBooking(type.id)}
                      className="items-center py-4 px-1"
                      style={hs.serviceTile}
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
                        <Icon size={22} color="#2563EB" strokeWidth={2} />
                      )}
                      <Text
                        className="text-[11px] font-montserrat-semi text-textPrimary text-center mt-2"
                        numberOfLines={1}
                      >
                        {type.name}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Recent — at most 3 rows, no card chrome, single inline
            section label with "See all" link to its right. */}
        {recentBookings.length > 0 ? (
          <View className="px-5 mt-7">
            <View className="flex-row items-baseline justify-between mb-2">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.4 }}
              >
                Recent
              </Text>
              <Pressable
                onPress={() => router.push('/(customer)/(tabs)/activity')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="See all errands"
              >
                <Text className="text-[11px] font-montserrat-bold text-primary underline">
                  See all
                </Text>
              </Pressable>
            </View>
            {recentBookings.map((booking, idx) => {
              const statusColor = STATUS_COLORS[booking.status] ?? '#94A3B8';
              return (
                <Pressable
                  key={booking.id}
                  className="flex-row items-center py-3.5"
                  style={
                    idx < recentBookings.length - 1
                      ? { borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }
                      : undefined
                  }
                  onPress={() =>
                    router.push(`/(customer)/tracking/${booking.id}`)
                  }
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
        ) : null}
      </ScrollView>
    </View>
  );
}

const hs = StyleSheet.create({
  headerGradient: {
    paddingBottom: 0,
    // Slight bottom rounding for a more deliberate header silhouette.
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  searchBox: {
    borderRadius: 14,
    // No border — the elevation does the visual lifting now that
    // the card sits on a coloured surface above the gradient.
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  pickupRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  chevronBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceTile: {
    borderRadius: 14,
    backgroundColor: '#F8FBFF',
    borderWidth: 1,
    borderColor: '#DCEBFF',
    minHeight: 88,
    justifyContent: 'center',
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
});
