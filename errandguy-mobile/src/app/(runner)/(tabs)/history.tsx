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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, MapPin, Navigation, CheckCircle, XCircle, MessageCircle } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
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
        <Card className="mx-5 mb-2 p-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-sm font-montserrat-bold text-textPrimary">
              {item.errand_type?.name ?? 'Errand'}
            </Text>
            <View className="flex-row items-center gap-1">
              {isCompleted ? (
                <CheckCircle size={14} color="#22C55E" />
              ) : (
                <XCircle size={14} color="#EF4444" />
              )}
              <Text
                className={`text-xs font-montserrat-bold ${
                  isCompleted ? 'text-success' : 'text-danger'
                }`}
              >
                {isCompleted ? 'Completed' : 'Cancelled'}
              </Text>
            </View>
          </View>

          <View className="flex-row items-start gap-2 mb-1">
            <MapPin size={12} color="#22C55E" />
            <Text className="text-xs font-montserrat text-textTertiary flex-1" numberOfLines={1}>
              {item.pickup_address}
            </Text>
          </View>
          <View className="flex-row items-start gap-2 mb-2">
            <Navigation size={12} color="#EF4444" />
            <Text className="text-xs font-montserrat text-textTertiary flex-1" numberOfLines={1}>
              {item.dropoff_address}
            </Text>
          </View>

          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-montserrat text-textTertiary">
              {new Date(item.completed_at ?? item.created_at).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
              })}{' '}
              •{' '}
              {new Date(item.completed_at ?? item.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
            <Text className="text-sm font-montserrat-bold text-primary">
              {formatCurrency(item.runner_payout ?? item.total_amount)}
            </Text>
          </View>
        </Card>
      );
    },
    [],
  );

  if (initialLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <HistorySkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
        <Text className="text-lg font-montserrat-bold text-textPrimary">Errand History</Text>
        <Pressable
          onPress={() => router.push('/(runner)/chat' as any)}
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

      {/* Search Bar */}
      <View className="px-5 mb-3">
        <View className="flex-row items-center bg-surface rounded-2xl px-4 gap-2" style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }}>
          <Search size={18} color="#94A3B8" />
          <TextInput
            className="flex-1 py-2.5 text-sm font-montserrat text-textPrimary"
            placeholder="Search errands..."
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {/* Status Filters */}
      <View className="flex-row gap-2 px-5 mb-3">
        {(['all', 'completed', 'cancelled'] as const).map((s) => (
          <Pressable
            key={s}
            onPress={() => setStatusFilter(s)}
            className={`px-4 py-1.5 rounded-full ${
              statusFilter === s ? 'bg-primary' : 'bg-surface'
            }`}
            style={statusFilter !== s ? { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 } : undefined}
          >
            <Text
              className={`text-xs font-montserrat-semi ${
                statusFilter === s ? 'text-white' : 'text-textTertiary'
              }`}
            >
              {s === 'all' ? 'All' : s === 'completed' ? 'Completed' : 'Cancelled'}
            </Text>
          </Pressable>
        ))}
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
          <View className="items-center py-20">
            <Text className="text-sm font-montserrat text-textSecondary">
              No errands found.
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center justify-center">
              <ActivityIndicator color="#2563EB" />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
