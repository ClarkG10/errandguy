import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
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
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore } from '../../../stores/bookingStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { bookingService } from '../../../services/booking.service';
import { configService } from '../../../services/config.service';
import { useRefreshOnFocus } from '../../../hooks/useRefreshOnFocus';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { SearchBar } from '../../../components/ui/SearchBar';
import { ActiveErrandBanner } from '../../../components/customer/ActiveErrandBanner';
import { ErrandTypeCard } from '../../../components/customer/ErrandTypeCard';
import { RecentErrandItem } from '../../../components/customer/RecentErrandItem';
import { HomeSkeleton } from '../../../components/ui/Skeleton';
import type { Booking, ErrandType } from '../../../types';
import { formatCurrency } from '../../../utils/formatCurrency';

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
  const { activeBooking, setActiveBooking } = useBookingStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const [errandTypes, setErrandTypes] = useState<ErrandType[]>([]);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchText, setSearchText] = useState('');

  const fetchData = useCallback(async () => {
    // Fetch independently so one failure doesn't block the others
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
      console.log('📦 Errand types fetched:', Array.isArray(types) ? types.length : 'not array', types);
      setErrandTypes(Array.isArray(types) ? types : []);
    } else {
      console.warn('Failed to fetch errand types:', results[1].reason?.message);
    }
    if (results[2].status === 'fulfilled') {
      const bookings = results[2].value.data?.data;
      setRecentBookings(Array.isArray(bookings) ? bookings : []);
    }
    setInitialLoading(false);
  }, [setActiveBooking]);

  useRefreshOnFocus(fetchData);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
          <View className="flex-row items-center flex-1">
            <Pressable onPress={() => router.push('/(customer)/(tabs)/profile')}>
              <Avatar
                uri={user?.avatar_url}
                name={user?.full_name}
                size="md"
              />
            </Pressable>
            <View className="ml-3 flex-1">
              <Text className="text-lg font-montserrat-bold text-textPrimary">
                {getGreeting()}, {firstName}!
              </Text>
            </View>
          </View>
          <Pressable
            className="relative p-2"
            onPress={() => router.push('/(customer)/(tabs)/notifications')}
          >
            <Bell size={24} color="#0F172A" />
            {unreadCount > 0 && (
              <View className="absolute top-0 right-0">
                <Badge count={unreadCount} variant="danger" size="sm" />
              </View>
            )}
          </Pressable>
        </View>

        {/* Search Bar */}
        <View className="px-5 py-2">
          <SearchBar
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search errand types..."
          />
        </View>

        {/* Active Errand */}
        {activeBooking && (
          <View className="px-5 py-2">
            <ActiveErrandBanner
              booking={activeBooking}
              onTrack={() =>
                router.push(`/(customer)/tracking/${activeBooking.id}`)
              }
            />
          </View>
        )}

        {/* Quick Actions */}
        <View className="px-5 py-3">
          <Text className="text-base font-montserrat-bold text-textPrimary mb-3">
            What do you need?
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12 }}
          >
            {errandTypes
              .filter((t) => t.is_active)
              .map((type) => (
                <ErrandTypeCard
                  key={type.id}
                  name={type.name}
                  icon={ICON_MAP[type.icon_name] ?? Package}
                  baseFee={type.base_fee}
                  onPress={() => {
                    router.push({
                      pathname: '/(customer)/book/type',
                      params: { preselected: type.id },
                    });
                  }}
                />
              ))}
          </ScrollView>
        </View>

        {/* Recent Errands */}
        <View className="px-5 py-3">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-base font-montserrat-bold text-textPrimary">
              Recent Errands
            </Text>
            <Pressable
              onPress={() => router.push('/(customer)/(tabs)/activity')}
            >
              <Text className="text-sm font-montserrat text-primary">
                See All
              </Text>
            </Pressable>
          </View>
          {recentBookings.length === 0 ? (
            <Card className="items-center py-8">
              <Text className="text-sm font-montserrat text-textSecondary">
                No errands yet. Book your first one!
              </Text>
            </Card>
          ) : (
            recentBookings.map((booking) => (
              <RecentErrandItem
                key={booking.id}
                booking={booking}
                onPress={() =>
                  router.push(`/(customer)/tracking/${booking.id}`)
                }
              />
            ))
          )}
        </View>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
