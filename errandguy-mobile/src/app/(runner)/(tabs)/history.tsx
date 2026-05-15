import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Search, MapPin, Navigation, CheckCircle, XCircle, MessageCircle, ClipboardList } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { RunnerEmptyState } from '../../../components/ui/RunnerEmptyState';
import { runnerService } from '../../../services/runner.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { formatCurrency } from '../../../utils/formatCurrency';
import { useDebounce } from '../../../hooks/useDebounce';
import { HistorySkeleton } from '../../../components/ui/Skeleton';
import type { Booking } from '../../../types';
import { toast } from '../../../stores/toastStore';

export default function HistoryScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const chatUnread = useChatStore((s) => s.unreadCount);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  // Page 1 is cached via useQuery (cache-first); subsequent pages append.
  const page1Q = useQuery<Booking[]>(
    ['runner', 'errands', 'history', statusFilter, userId],
    async () => {
      const params: Record<string, any> = { page: 1, per_page: 15 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await runnerService.getErrandHistory(params);
      return (res.data.data ?? []) as Booking[];
    },
    { staleTime: 60_000, ttl: CacheTTL.LONG },
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
  }, [statusFilter]);

  // Sync hasMore based on page-1 size.
  useEffect(() => {
    if (page1Q.data) setHasMore((page1Q.data.length ?? 0) >= 15);
  }, [page1Q.data]);

  const errands = useMemo(
    () => [...(page1Q.data ?? []), ...extraPages],
    [page1Q.data, extraPages],
  );
  const initialLoading = page1Q.loading && !page1Q.data;

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
      const params: Record<string, any> = { page: nextPage, per_page: 15 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await runnerService.getErrandHistory(params);
      const data: Booking[] = res.data.data ?? [];
      setExtraPages((prev) => [...prev, ...data]);
      setPage(nextPage);
      setHasMore(data.length >= 15);
    } catch {
      toast.error('Failed to load more history');
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, page, statusFilter]);

  const filteredErrands = useMemo(() => {
    if (!debouncedSearch.trim()) return errands;
    const q = debouncedSearch.toLowerCase();
    return errands.filter(
      (e) =>
        e.booking_number?.toLowerCase().includes(q) ||
        e.pickup_address?.toLowerCase().includes(q) ||
        e.dropoff_address?.toLowerCase().includes(q) ||
        e.errand_type?.name?.toLowerCase().includes(q),
    );
  }, [errands, debouncedSearch]);

  const renderItem = useCallback(
    ({ item }: { item: Booking }) => {
      const isCompleted = item.status === 'completed';
      return (
        <Pressable
          className="flex-row items-center px-5 py-3.5 border-b border-divider"
          onPress={() => router.push(`/(runner)/errand/${item.id}` as any)}
        >
          <View className="flex-1 pr-3">
            <View className="flex-row items-center mb-1">
              <Text className="text-[14px] font-montserrat-bold text-textPrimary" numberOfLines={1}>
                {item.errand_type?.name ?? 'Errand'}
              </Text>
              <Text className="text-[11px] font-montserrat text-textMuted ml-2">
                {new Date(item.completed_at ?? item.created_at).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
            </View>
            <Text className="text-[12px] font-montserrat text-textSecondary" numberOfLines={1}>
              {item.pickup_address}
            </Text>
            {item.dropoff_address ? (
              <Text className="text-[12px] font-montserrat text-textMuted" numberOfLines={1}>
                → {item.dropoff_address}
              </Text>
            ) : null}
          </View>
          <View className="items-end">
            <Text
              className={`text-[15px] font-inter tabular-nums ${
                isCompleted ? 'text-textPrimary' : 'text-textMuted'
              }`}
              style={{ fontWeight: '600' }}
            >
              {formatCurrency(item.runner_payout ?? item.total_amount)}
            </Text>
            <Text
              className={`text-[10px] font-montserrat-bold uppercase mt-0.5 ${
                isCompleted ? 'text-success' : 'text-danger'
              }`}
              style={{ letterSpacing: 1 }}
            >
              {isCompleted ? 'Paid' : 'Cancelled'}
            </Text>
          </View>
        </Pressable>
      );
    },
    [router],
  );

  if (initialLoading) {
    return (
      <View className="flex-1 bg-background">
        <GradientHeader title="Errands" />
        <HistorySkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Errands"
        trailing={{
          icon: MessageCircle,
          onPress: () => router.push('/(runner)/chat' as any),
          badge: chatUnread,
          accessibilityLabel: 'Messages',
        }}
      />

      {/* Search — thin underline input, no card */}
      <View className="px-5 mb-2">
        <View className="flex-row items-center border-b border-divider pb-2">
          <Search size={16} color="#94A3B8" strokeWidth={1.6} />
          <TextInput
            className="flex-1 ml-2 text-[14px] font-montserrat text-textPrimary"
            placeholder="Search errands"
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {/* Status Filters — underline tabs (no pills) */}
      <View className="flex-row px-5 mb-1 border-b border-divider">
        {(['all', 'completed', 'cancelled'] as const).map((s) => {
          const active = statusFilter === s;
          return (
            <Pressable
              key={s}
              onPress={() => setStatusFilter(s)}
              className="pr-5 pb-2.5 -mb-px"
              style={active ? { borderBottomWidth: 2, borderBottomColor: '#2563EB' } : undefined}
              hitSlop={6}
            >
              <Text
                className={`text-[12px] ${
                  active
                    ? 'font-montserrat-bold text-textPrimary'
                    : 'font-montserrat-semi text-textMuted'
                }`}
              >
                {s === 'all' ? 'All' : s === 'completed' ? 'Completed' : 'Cancelled'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* List */}
      <FlatList
        data={filteredErrands}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        ListEmptyComponent={
          <RunnerEmptyState
            icon={ClipboardList}
            eyebrow="No history yet"
            title="No completed errands"
            description="Once you finish a job it'll show up here with its payout."
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center justify-center">
              <ActivityIndicator color="#2563EB" />
            </View>
          ) : null
        }
      />
    </View>
  );
}
