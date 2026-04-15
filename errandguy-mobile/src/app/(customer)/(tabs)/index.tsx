import React, { useCallback, useRef, useState } from 'react';
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
  MapPin,
  ArrowRight,
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
import { CacheService, CacheTTL, CacheKeys } from '../../../services/cache.service';
import { useRefreshOnFocus } from '../../../hooks/useRefreshOnFocus';
import { Avatar } from '../../../components/ui/Avatar';
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
  const { activeBooking, setActiveBooking, clearDraft } = useBookingStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const [errandTypes, setErrandTypes] = useState<ErrandType[]>([]);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasCacheLoaded = useRef(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    // Don't fetch customer data if the user is a runner — this screen
    // may briefly mount before the layout guard redirects.
    if (role !== 'customer') return;

    setError(null);

    // On first load, try cache first to avoid skeleton
    if (!hasCacheLoaded.current && !isRefresh) {
      const [cachedTypes, cachedBookings] = await Promise.all([
        CacheService.get<ErrandType[]>(CacheKeys.errandTypes()),
        CacheService.get<Booking[]>(CacheKeys.bookingHistory(user?.id ?? 'anon')),
      ]);
      if (cachedTypes) setErrandTypes(cachedTypes);
      if (cachedBookings) setRecentBookings(cachedBookings);
      if (cachedTypes || cachedBookings) {
        hasCacheLoaded.current = true;
        setInitialLoading(false);
      }
    }

    try {
      const results = await Promise.allSettled([
        bookingService.getActiveBooking(),
        configService.getErrandTypes(),
        bookingService.getBookings({ per_page: 3 }),
      ]);

      if (results[0].status === 'fulfilled') {
        setActiveBooking(results[0].value.data.data ?? null);
      }
      if (results[1].status === 'fulfilled') {
        const types = results[1].value.data?.data;
        const typesArray = Array.isArray(types) ? types : [];
        setErrandTypes(typesArray);
        CacheService.set(CacheKeys.errandTypes(), typesArray, CacheTTL.STATIC);
      }
      if (results[2].status === 'fulfilled') {
        const bookings = results[2].value.data?.data;
        const bookingsArray = Array.isArray(bookings) ? bookings : [];
        setRecentBookings(bookingsArray);
        CacheService.set(CacheKeys.bookingHistory(user?.id ?? 'anon'), bookingsArray, CacheTTL.SHORT);
      }

      // If all failed, show error
      const allFailed = results.every((r) => r.status === 'rejected');
      if (allFailed) {
        setError('Unable to load data. Please check your connection.');
        toast.error('Unable to load data. Please check your connection.');
      }
    } catch {
      setError('Something went wrong. Pull down to retry.');
      toast.error('Something went wrong. Pull down to retry.');
    }

    hasCacheLoaded.current = true;
    setInitialLoading(false);
  }, [setActiveBooking, user?.id, role]);

  useRefreshOnFocus(fetchData);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true);
    setRefreshing(false);
  }, [fetchData]);

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
        contentContainerStyle={{ paddingBottom: 100 }}
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
            className="relative w-10 h-10 rounded-full bg-primary50 items-center justify-center"
            onPress={() => router.push('/(customer)/(tabs)/notifications')}
          >
            <Bell size={20} color="#2563EB" strokeWidth={1.8} />
            {unreadCount > 0 && (
              <View className="absolute -top-0.5 -right-0.5 rounded-full items-center justify-center" style={{ width: 18, height: 18, backgroundColor: '#EF4444' }}>
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

        {/* ── Active Errand ── */}
        {activeBooking && (
          <Pressable
            className="mx-5 mt-4 rounded-2xl overflow-hidden bg-primary"
            style={hs.card}
            onPress={() => router.push(`/(customer)/tracking/${activeBooking.id}`)}
          >
            <View className="p-4">
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center">
                  <View className="w-2 h-2 rounded-full bg-white mr-2" />
                  <Text className="text-xs font-montserrat-bold text-white/90">
                    Active Errand
                  </Text>
                </View>
                <View className="bg-white/15 rounded-full px-2.5 py-1">
                  <Text style={{ fontSize: 10, fontFamily: 'Quicksand_600SemiBold', color: '#FFF' }}>
                    {STATUS_LABELS[activeBooking.status] ?? activeBooking.status}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center mb-1.5">
                <MapPin size={12} color="rgba(255,255,255,0.6)" />
                <Text className="text-xs font-montserrat text-white/70 ml-1.5 flex-1" numberOfLines={1}>
                  {activeBooking.pickup_address}
                </Text>
              </View>
              <View className="flex-row items-center">
                <MapPin size={12} color="rgba(255,255,255,0.6)" />
                <Text className="text-xs font-montserrat text-white/70 ml-1.5 flex-1" numberOfLines={1}>
                  {activeBooking.dropoff_address}
                </Text>
              </View>
              <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-white/10">
                <Text className="text-base font-montserrat-bold text-white">
                  {formatCurrency(activeBooking.total_amount)}
                </Text>
                <View className="flex-row items-center bg-white rounded-full px-3.5 py-1.5">
                  <Text style={{ fontSize: 12, fontFamily: 'Quicksand_600SemiBold', color: '#2563EB' }}>
                    Track
                  </Text>
                  <ArrowRight size={14} color="#2563EB" style={{ marginLeft: 4 }} />
                </View>
              </View>
            </View>
          </Pressable>
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
                    <View className="w-11 h-11 rounded-xl bg-primary50 items-center justify-center mb-2">
                      <Icon size={20} color="#2563EB" strokeWidth={1.8} />
                    </View>
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
              <View className="w-14 h-14 rounded-2xl bg-primary50 items-center justify-center mb-3">
                <Package size={22} color="#2563EB" />
              </View>
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
                    <View className="w-10 h-10 rounded-xl bg-primary50 items-center justify-center mr-3">
                      <Package size={18} color="#2563EB" />
                    </View>
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
