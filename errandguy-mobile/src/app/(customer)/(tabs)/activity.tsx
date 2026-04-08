import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
  ScrollView,
} from 'react-native';
import { ClipboardList } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bookingService } from '../../../services/booking.service';
import { EmptyState } from '../../../components/ui/EmptyState';
import { RecentErrandItem } from '../../../components/customer/RecentErrandItem';
import { BookingDetailSheet } from '../../../components/customer/BookingDetailSheet';
import type { Booking, BookingStatus } from '../../../types';

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
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const fetchBookings = useCallback(
    async (pageNum: number, reset = false) => {
      try {
        setLoading(true);
        const res = await bookingService.getBookings({
          status: FILTER_STATUS_MAP[filter],
          page: pageNum,
          per_page: 15,
        });
        const data: Booking[] = res.data.data ?? [];
        if (reset) {
          setBookings(data);
        } else {
          setBookings((prev) => [...prev, ...data]);
        }
        setHasMore(data.length === 15);
        setPage(pageNum);
      } catch {
        if (reset) setBookings([]);
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    fetchBookings(1, true);
  }, [fetchBookings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBookings(1, true);
    setRefreshing(false);
  }, [fetchBookings]);

  const onEndReached = useCallback(() => {
    if (hasMore && !loading) {
      fetchBookings(page + 1);
    }
  }, [hasMore, loading, page, fetchBookings]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 py-4">
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          Activity
        </Text>
      </View>

      {/* Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="px-5 mb-3"
        contentContainerStyle={{ gap: 8 }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            className={`px-4 py-2 rounded-full ${
              filter === f.key ? 'bg-primary' : 'bg-divider'
            }`}
            onPress={() => setFilter(f.key)}
          >
            <Text
              className={`text-sm font-montserrat-bold ${
                filter === f.key ? 'text-white' : 'text-textSecondary'
              }`}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

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
