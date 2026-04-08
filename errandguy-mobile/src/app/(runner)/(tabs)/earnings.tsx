import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
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

  const [period, setPeriod] = useState<Period>('week');
  const [earningsData, setEarningsData] = useState<EarningsData | null>(null);
  const [earningsList, setEarningsList] = useState<Booking[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEarnings = useCallback(async () => {
    try {
      const [summaryRes, historyRes] = await Promise.all([
        runnerService.getEarnings(period),
        runnerService.getEarningsHistory({ page: 1, per_page: 10 }),
      ]);
      setEarningsData(summaryRes.data.data);
      setEarningsList(historyRes.data.data ?? []);
    } catch {
      // silent
    }
  }, [period]);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEarnings();
    setRefreshing(false);
  }, [fetchEarnings]);

  const periodLabel: Record<Period, string> = {
    today: "Today's Earnings",
    week: "This Week's Earnings",
    month: "This Month's Earnings",
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 py-4">
        <Text className="text-lg font-montserrat-bold text-textPrimary">Earnings</Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Hero Card */}
        <View className="mx-5 mb-4 bg-primaryLight rounded-2xl p-6 items-center">
          <Text className="text-3xl font-montserrat-bold text-textPrimary">
            {formatCurrency(earningsData?.total_earnings ?? 0)}
          </Text>
          <Text className="text-sm font-montserrat text-textSecondary mt-1">
            {periodLabel[period]}
          </Text>
        </View>

        {/* Period Selector */}
        <View className="flex-row mx-5 mb-4 bg-surface rounded-xl border border-divider overflow-hidden">
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              className={`flex-1 py-2.5 items-center ${
                period === p ? 'bg-primary' : ''
              }`}
            >
              <Text
                className={`text-sm font-montserrat-bold ${
                  period === p ? 'text-white' : 'text-textSecondary'
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
              <Text className="text-sm font-montserrat text-textSecondary">Total Errands</Text>
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {earningsData?.total_errands ?? 0}
              </Text>
            </View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-montserrat text-textSecondary">Avg per Errand</Text>
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {formatCurrency(earningsData?.avg_per_errand ?? 0)}
              </Text>
            </View>
            <View className="border-t border-divider pt-2 mt-1 flex-row items-center justify-between">
              <Text className="text-sm font-montserrat-bold text-textPrimary">Total</Text>
              <Text className="text-base font-montserrat-bold text-primary">
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
                  <Text className="text-sm font-montserrat-bold text-primary">
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
            title="Request Payout →"
            variant="outline"
            onPress={() => router.push('/(runner)/payout' as any)}
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
