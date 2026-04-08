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
import { Search, MapPin, Navigation, CheckCircle, XCircle } from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { runnerService } from '../../../services/runner.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { useDebounce } from '../../../hooks/useDebounce';
import type { Booking } from '../../../types';

export default function HistoryScreen() {
  const [errands, setErrands] = useState<Booking[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const fetchErrands = useCallback(
    async (pageNum: number, replace = false) => {
      try {
        const params: Record<string, any> = {
          page: pageNum,
          per_page: 15,
        };
        if (statusFilter !== 'all') params.status = statusFilter;

        const res = await runnerService.getErrandHistory(params);
        const data: Booking[] = res.data.data ?? [];

        if (replace) {
          setErrands(data);
        } else {
          setErrands((prev) => [...prev, ...data]);
        }
        setHasMore(data.length >= 15);
      } catch {
        // silent
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    setPage(1);
    fetchErrands(1, true);
  }, [statusFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await fetchErrands(1, true);
    setRefreshing(false);
  }, [fetchErrands]);

  const onEndReached = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);
    await fetchErrands(nextPage);
    setLoadingMore(false);
  }, [hasMore, loadingMore, page, fetchErrands]);

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
            <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={1}>
              {item.pickup_address}
            </Text>
          </View>
          <View className="flex-row items-start gap-2 mb-2">
            <Navigation size={12} color="#EF4444" />
            <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={1}>
              {item.dropoff_address}
            </Text>
          </View>

          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-montserrat text-textSecondary">
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

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 py-4">
        <Text className="text-lg font-montserrat-bold text-textPrimary">Errand History</Text>
      </View>

      {/* Search Bar */}
      <View className="px-5 mb-3">
        <View className="flex-row items-center bg-surface border border-divider rounded-xl px-3 gap-2">
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
              statusFilter === s ? 'bg-primary' : 'bg-surface border border-divider'
            }`}
          >
            <Text
              className={`text-xs font-montserrat-bold ${
                statusFilter === s ? 'text-white' : 'text-textSecondary'
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
            <View className="py-4">
              <ActivityIndicator color="#2563EB" />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
