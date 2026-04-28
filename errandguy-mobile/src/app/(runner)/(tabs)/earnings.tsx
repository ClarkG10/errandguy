import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import type { Booking } from '../../../types';

type Period = 'today' | 'week' | 'month';

interface EarningsData {
  total_earnings: number;
  total_errands: number;
  avg_per_errand: number;
}

export default function EarningsScreen() {
  const router = useRouter();
  const { earnings, setEarnings } = useRunnerStore();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');

  const [period, setPeriod] = useState<Period>('week');
  const [refreshing, setRefreshing] = useState(false);

  const summaryQ = useQuery<EarningsData>(
    ['runner', 'earnings', period, userId],
    async () => (await runnerService.getEarnings(period)).data.data,
    { staleTime: 60_000, ttl: CacheTTL.MEDIUM },
  );
  const historyQ = useQuery<Booking[]>(
    ['runner', 'earnings', 'history', userId],
    async () => ((await runnerService.getEarningsHistory({ page: 1, per_page: 10 })).data.data ?? []) as Booking[],
    { staleTime: 60_000, ttl: CacheTTL.LONG },
  );

  const earningsData = summaryQ.data ?? null;
  const earningsList = historyQ.data ?? [];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([summaryQ.refresh(), historyQ.refresh()]);
    setRefreshing(false);
  }, [summaryQ, historyQ]);

  const periodLabel: Record<Period, string> = {
    today: "Today's Earnings",
    week: "This Week's Earnings",
    month: "This Month's Earnings",
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 pt-4 pb-2">
        <Text className="text-lg font-montserrat-bold text-textPrimary">Earnings</Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Hero Card */}
        <View className="mx-5 mb-4 bg-primary rounded-2xl p-6 items-center">
          <Text className="text-3xl font-inter-semi tabular-nums text-white">
            {formatCurrency(earningsData?.total_earnings ?? 0)}
          </Text>
          <Text className="text-sm font-montserrat text-white/70 mt-1">
            {periodLabel[period]}
          </Text>
        </View>

        {/* Period Selector */}
        <View className="flex-row mx-5 mb-4 bg-surface rounded-2xl overflow-hidden" style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }}>
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              className={`flex-1 py-2.5 items-center ${
                period === p ? 'bg-primary' : ''
              }`}
              style={period === p ? { borderRadius: 16 } : undefined}
            >
              <Text
                className={`text-sm font-montserrat-semi ${
                  period === p ? 'text-white' : 'text-textTertiary'
                }`}
              >
                {p === 'today' ? 'Today' : p === 'week' ? 'Week' : 'Month'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Breakdown */}
        <View className="px-5 mb-4">
          <Card className="p-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-montserrat text-textTertiary">Total Errands</Text>
              <Text className="text-sm font-inter-semi tabular-nums text-textPrimary">
                {earningsData?.total_errands ?? 0}
              </Text>
            </View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-montserrat text-textTertiary">Avg per Errand</Text>
              <Text className="text-sm font-inter-semi tabular-nums text-textPrimary">
                {formatCurrency(earningsData?.avg_per_errand ?? 0)}
              </Text>
            </View>
            <View className="border-t border-divider pt-2 mt-1 flex-row items-center justify-between">
              <Text className="text-sm font-montserrat-bold text-textPrimary">Total</Text>
              <Text className="text-base font-inter-semi tabular-nums text-primary">
                {formatCurrency(earningsData?.total_earnings ?? 0)}
              </Text>
            </View>
          </Card>
        </View>

        {/* Chart Placeholder */}
        <View className="px-5 mb-4">
          <Card className="h-40 items-center justify-center">
            <Text className="text-sm font-montserrat text-textSecondary">
              Daily Chart
            </Text>
            <Text className="text-xs font-montserrat text-gray-400">(Coming soon)</Text>
          </Card>
        </View>

        {/* Per-Errand Earnings List */}
        <View className="px-5 mb-4">
          <Text className="text-sm font-montserrat-bold text-textSecondary mb-2">
            Per-Errand Earnings
          </Text>
          {earningsList.length === 0 ? (
            <Card className="items-center py-6">
              <Text className="text-sm font-montserrat text-textSecondary">
                No earnings yet for this period.
              </Text>
            </Card>
          ) : (
            earningsList.map((errand) => (
              <Card key={errand.id} className="mb-2 p-3">
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-sm font-montserrat-bold text-textPrimary">
                      {errand.errand_type?.name ?? 'Errand'}
                    </Text>
                    <Text className="text-xs font-montserrat text-textSecondary">
                      {new Date(errand.completed_at ?? errand.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Text className="text-sm font-inter-semi tabular-nums text-primary">
                    {formatCurrency(errand.runner_payout ?? errand.total_amount)}
                  </Text>
                </View>
              </Card>
            ))
          )}
        </View>

        {/* Payout Button */}
        <View className="px-5 mb-4">
          <Button
            title="Request Payout"
            variant="outline"
            onPress={() => router.push('/(runner)/payout' as any)}
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
