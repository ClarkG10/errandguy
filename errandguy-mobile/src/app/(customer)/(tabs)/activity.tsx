import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  RefreshControl,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { ClipboardList, MessageCircle } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { bookingService } from '../../../services/booking.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
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
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const chatUnread = useChatStore((s) => s.unreadCount);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  // Page 1 cached per filter; subsequent pages live in local state.
  // staleTime is generous (2 min) because mutations (create/cancel/review)
  // call invalidateQuery(['bookings']) which forces an immediate refresh.
  // Without that signal, the list rarely needs to revalidate on focus.
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
    { staleTime: 120_000, ttl: CacheTTL.LONG },
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

  // Bucket bookings by date so the list reads as a journal rather than
  // a flat infinite scroll. Active filter buckets by status instead
  // (Today/Yesterday is meaningless when everything is in-progress).
  const sections = useMemo<{ title: string; data: Booking[] }[]>(() => {
    if (!bookings.length) return [];
    if (filter === 'active') {
      const onTheWay: Booking[] = [];
      const inProgress: Booking[] = [];
      const searching: Booking[] = [];
      for (const b of bookings) {
        if (b.status === 'pending') {
          searching.push(b);
        } else if (b.status === 'matched' || b.status === 'accepted') {
          onTheWay.push(b);
        } else {
          inProgress.push(b);
        }
      }
      return [
        { title: 'In progress', data: inProgress },
        { title: 'On the way', data: onTheWay },
        { title: 'Looking for runner', data: searching },
      ].filter((s) => s.data.length > 0);
    }
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const buckets: Record<string, Booking[]> = {
      Today: [],
      Yesterday: [],
      'This Week': [],
      Earlier: [],
    };
    for (const b of bookings) {
      const ts = new Date(b.created_at).getTime();
      if (ts >= startOfToday) buckets.Today.push(b);
      else if (ts >= startOfYesterday) buckets.Yesterday.push(b);
      else if (ts >= startOfWeek) buckets['This Week'].push(b);
      else buckets.Earlier.push(b);
    }
    return (['Today', 'Yesterday', 'This Week', 'Earlier'] as const)
      .filter((title) => buckets[title].length > 0)
      .map((title) => ({ title, data: buckets[title] }));
  }, [bookings, filter]);

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
      <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
        <Text className="text-lg font-montserrat-semi text-textPrimary">
          Activity
        </Text>
        <Pressable
          onPress={() => router.push('/(customer)/chat' as any)}
          className="w-10 h-10 rounded-full items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel="Messages"
          accessibilityHint={chatUnread > 0 ? `${chatUnread} unread messages` : undefined}
          hitSlop={8}
        >
          <View>
            <MessageCircle size={22} color="#0F172A" />
            {chatUnread > 0 && (
              <View
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  paddingHorizontal: 3,
                  backgroundColor: '#DC2626',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: '#FFFFFF',
                }}
              >
                <Text className="text-[9px] font-montserrat-bold text-white">
                  {chatUnread > 9 ? '9+' : chatUnread}
                </Text>
              </View>
            )}
          </View>
        </Pressable>
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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className="px-5">
            <RecentErrandItem
              booking={item}
              onPress={() => setSelectedBooking(item)}
            />
          </View>
        )}
        renderSectionHeader={({ section: { title, data } }) => (
          <View className="flex-row items-center justify-between px-5 pt-3 pb-2 bg-background">
            <Text className="text-[11px] font-montserrat-bold text-textTertiary uppercase tracking-wider">
              {title}
            </Text>
            <Text className="text-[10px] font-montserrat text-textTertiary">
              {data.length}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center">
              <ActivityIndicator size="small" color="#2563EB" />
            </View>
          ) : !hasMore && bookings.length > 0 ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                That's everything
              </Text>
            </View>
          ) : null
        }
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
