import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
} from 'react-native';
import { ClipboardList } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bookingService } from '../../../services/booking.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { useAuthStore } from '../../../stores/authStore';
import { EmptyState } from '../../../components/ui/EmptyState';
import { RecentErrandItem } from '../../../components/customer/RecentErrandItem';
import { BookingDetailSheet } from '../../../components/customer/BookingDetailSheet';
import { ActivitySkeleton } from '../../../components/ui/Skeleton';
import type { Booking, BookingStatus } from '../../../types';
import { toast } from '../../../stores/toastStore';

type FilterKey = 'all' | 'active' | 'completed' | 'cancelled';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const FILTER_STATUS_MAP: Record<FilterKey, string | undefined> = {
  all: undefined,
  active: 'active',
  completed: 'completed',
  cancelled: 'cancelled',
};

export default function ActivityScreen() {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  // Page 1 cached per filter; subsequent pages live in local state.
  const page1Q = useQuery<Booking[]>(
    ['bookings', 'activity', filter, userId],
    async () => {
      const res = await bookingService.getBookings({
        status: FILTER_STATUS_MAP[filter],
        page: 1,
        per_page: 15,
      });
      return (res.data.data ?? []) as Booking[];
    },
    { staleTime: 30_000, ttl: CacheTTL.LONG },
  );

  const [extraPages, setExtraPages] = useState<Booking[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reset pagination when filter changes.
  useEffect(() => {
    setExtraPages([]);
    setPage(1);
    setHasMore(true);
  }, [filter]);

  useEffect(() => {
    if (page1Q.data) setHasMore((page1Q.data.length ?? 0) >= 15);
  }, [page1Q.data]);

  const bookings = useMemo(
    () => [...(page1Q.data ?? []), ...extraPages],
    [page1Q.data, extraPages],
  );
  const loading = page1Q.loading && !page1Q.data;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setExtraPages([]);
    setPage(1);
    setHasMore(true);
    await page1Q.refresh();
    setRefreshing(false);
  }, [page1Q]);

  const onEndReached = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const res = await bookingService.getBookings({
        status: FILTER_STATUS_MAP[filter],
        page: nextPage,
        per_page: 15,
      });
      const data: Booking[] = res.data.data ?? [];
      setExtraPages((prev) => [...prev, ...data]);
      setPage(nextPage);
      setHasMore(data.length >= 15);
    } catch {
      toast.error('Failed to load more.');
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, page, filter]);

  if (loading && bookings.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <ActivitySkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 pt-4 pb-2">
        <Text className="text-lg font-montserrat-semi text-textPrimary">
          Activity
        </Text>
      </View>

      {/* Filters */}
      <View className="flex-row px-5 mb-3" style={{ gap: 6 }}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            className={`px-3 py-1 rounded-lg ${
              filter === f.key ? 'bg-primary' : 'bg-surface'
            }`}
            style={filter !== f.key ? { borderWidth: 1, borderColor: '#E2E8F0' } : undefined}
            onPress={() => setFilter(f.key)}
          >
            <Text
              className={`text-xs font-montserrat-semi ${
                filter === f.key ? 'text-white' : 'text-textSecondary'
              }`}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Booking List */}
      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className="px-5">
            <RecentErrandItem
              booking={item}
              onPress={() => setSelectedBooking(item)}
            />
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon={ClipboardList}
              title="No errands yet"
              description="Book your first errand to get started"
            />
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />

      {/* Booking Detail Sheet */}
      <BookingDetailSheet
        booking={selectedBooking}
        isVisible={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
      />
    </SafeAreaView>
  );
}
