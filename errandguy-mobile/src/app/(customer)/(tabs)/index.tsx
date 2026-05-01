import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Package,
  ShoppingCart,
  UtensilsCrossed,
  FileText,
  Shirt,
  Car,
  PenTool,
  Bell,
  ChevronRight,
  Search,
  AlertCircle,
  RefreshCw,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore } from '../../../stores/bookingStore';
import { toast } from '../../../stores/toastStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { bookingService } from '../../../services/booking.service';
import { configService } from '../../../services/config.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { Avatar } from '../../../components/ui/Avatar';
import { ActiveBookingCard } from '../../../components/customer/ActiveBookingCard';
import { HomeSkeleton } from '../../../components/ui/Skeleton';
import { STATUS_LABELS, STATUS_COLORS } from '../../../constants/statusLabels';
import type { Booking, ErrandType } from '../../../types';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatRelativeTime } from '../../../utils/formatDate';

const ICON_MAP: Record<string, LucideIcon> = {
  Package,
  ShoppingCart,
  UtensilsCrossed,
  FileText,
  Shirt,
  Car,
  PenTool,
};

export default function CustomerHomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const enabled = role === 'customer';

  // ── SWR-style queries ──
  // Each query reads from AsyncStorage on mount (instant render with last
  // known data), then revalidates in the background only if the cache is
  // older than `staleTime`. Mutations elsewhere (createBooking, cancel…)
  // invalidate the relevant cache so users always see fresh data without
  // an explicit refetch on every mount.
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

  const errandTypes = errandTypesQ.data ?? [];
  const recentBookings = recentBookingsQ.data ?? [];
  const initialLoading =
    enabled && (errandTypesQ.loading || recentBookingsQ.loading) &&
    errandTypes.length === 0 && recentBookings.length === 0;
  const error: string | null = null;

  // Sync active booking into the global store — but only AFTER the
  // query has resolved at least once. Without the loaded-once guard the
  // initial undefined `data` would clobber an in-flight booking that
  // another screen (or a push notification) had already populated.
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

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  if (initialLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <HomeSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#2563EB"
            colors={['#2563EB']}
          />
        }
      >
        {/* ── Header ── */}
        <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
          <View className="flex-row items-center flex-1">
            <Pressable onPress={() => router.push('/(customer)/(tabs)/profile')}>
              <Avatar uri={user?.avatar_url} name={user?.full_name} size="md" />
            </Pressable>
            <View className="ml-3 flex-1">
              <Text className="text-xs font-montserrat text-textTertiary">
                {getGreeting()}
              </Text>
              <Text className="text-lg font-montserrat-bold text-textPrimary" numberOfLines={1}>
                {firstName}
              </Text>
            </View>
          </View>
          <Pressable
            className="relative w-10 h-10 items-center justify-center"
            hitSlop={8}
            onPress={() => router.push('/(customer)/(tabs)/notifications')}
          >
            <Bell size={22} color="#475569" strokeWidth={1.8} />
            {unreadCount > 0 && (
              <View className="absolute top-1 right-1 rounded-full items-center justify-center" style={{ width: 18, height: 18, backgroundColor: '#EF4444' }}>
                <Text style={{ fontSize: 9, fontFamily: 'Quicksand_600SemiBold', color: '#FFF' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* ── Search ── */}
        <Pressable
          className="mx-5 mt-3 flex-row items-center bg-surface rounded-2xl px-4 h-12"
          style={hs.card}
          onPress={() => { clearDraft(); router.push('/(customer)/book/type'); }}
        >
          <Search size={18} color="#94A3B8" strokeWidth={1.8} />
          <Text className="ml-3 text-sm font-montserrat text-textTertiary flex-1">
            What do you need help with?
          </Text>
        </Pressable>

        {/* ── Error Banner ── */}
        {error && (
          <Pressable
            className="mx-5 mt-3 flex-row items-center bg-danger/10 rounded-2xl px-4 py-3"
            onPress={onRefresh}
          >
            <AlertCircle size={18} color="#EF4444" />
            <Text className="flex-1 text-xs font-montserrat text-danger ml-2.5">{error}</Text>
            <RefreshCw size={14} color="#EF4444" />
          </Pressable>
        )}

        {/* ── Active Errand ──
             Status-aware card with runner avatar, rating, headline copy
             tailored to the current phase, segmented progress bar, and
             a pulsing dot while we're still searching for a runner. */}
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

        {/* ── Services ── */}
        <View className="px-5 mt-6">
          <Text className="text-base font-montserrat-bold text-textPrimary mb-3">
            Services
          </Text>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            {errandTypes
              .filter((t) => t.is_active)
              .map((type) => {
                const Icon = ICON_MAP[type.icon_name] ?? Package;
                return (
                  <Pressable
                    key={type.id}
                    className="bg-surface rounded-2xl items-center justify-center py-4 px-2"
                    style={[hs.serviceCard, hs.card]}
                    onPress={() => {
                      clearDraft();
                      router.push({
                        pathname: '/(customer)/book/type',
                        params: { preselected: type.id },
                      });
                    }}
                  >
                    <Icon size={26} color="#2563EB" strokeWidth={1.6} style={{ marginBottom: 8 }} />
                    <Text
                      className="text-[11px] font-montserrat-semi text-textPrimary text-center"
                      numberOfLines={2}
                    >
                      {type.name}
                    </Text>
                    <Text className="text-[10px] font-montserrat text-textTertiary mt-0.5">
                      From {formatCurrency(type.base_fee)}
                    </Text>
                  </Pressable>
                );
              })}
          </View>
        </View>

        {/* ── Recent ── */}
        <View className="px-5 mt-6">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-base font-montserrat-bold text-textPrimary">
              Recent Errands
            </Text>
            {recentBookings.length > 0 && (
              <Pressable
                onPress={() => router.push('/(customer)/(tabs)/activity')}
                className="flex-row items-center"
              >
                <Text className="text-xs font-montserrat-semi text-primary mr-0.5">
                  See All
                </Text>
                <ChevronRight size={14} color="#2563EB" />
              </Pressable>
            )}
          </View>
          {recentBookings.length === 0 ? (
            <View className="bg-surface rounded-2xl items-center py-10 px-6" style={hs.card}>
              <Text className="text-sm font-montserrat-semi text-textPrimary mb-1">
                No errands yet
              </Text>
              <Text className="text-xs font-montserrat text-textTertiary text-center">
                Book your first errand and it will show here
              </Text>
            </View>
          ) : (
            recentBookings.map((booking) => {
              const statusColor = STATUS_COLORS[booking.status] ?? '#94A3B8';
              return (
                <Pressable
                  key={booking.id}
                  className="bg-surface rounded-2xl p-4 mb-2.5"
                  style={hs.card}
                  onPress={() => router.push(`/(customer)/tracking/${booking.id}`)}
                >
                  <View className="flex-row items-center">
                    <View className="flex-1">
                      <Text className="text-sm font-montserrat-bold text-textPrimary" numberOfLines={1}>
                        {booking.errand_type?.name ?? 'Errand'}
                      </Text>
                      <Text className="text-[11px] font-montserrat text-textTertiary mt-0.5">
                        {formatRelativeTime(booking.created_at)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-montserrat-bold text-textPrimary">
                        {formatCurrency(booking.total_amount)}
                      </Text>
                      <View
                        className="px-2 py-0.5 rounded-full mt-1"
                        style={{ backgroundColor: statusColor + '15' }}
                      >
                        <Text
                          style={{ fontSize: 10, fontFamily: 'Quicksand_500Medium', color: statusColor }}
                        >
                          {STATUS_LABELS[booking.status] ?? booking.status}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const hs = StyleSheet.create({
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  serviceCard: {
    width: '30%',
    flexGrow: 1,
    minWidth: 100,
  },
});
