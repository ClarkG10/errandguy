import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Eyebrow, Hairline } from '../../../components/ui/Typography';
import { GradientHeader } from '../../../components/ui/GradientHeader';
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
  // Compute the date range that matches the selected period so the per-
  // errand list reflects the same window as the hero card. Previously
  // the list ignored `period` entirely and showed the latest 10 across
  // all time — customers/runners reported the row totals not adding
  // up to the hero amount.
  const dateFrom = useMemo(() => {
    const now = new Date();
    if (period === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    }
    if (period === 'week') {
      const monday = new Date(now);
      const day = monday.getDay() || 7; // Sunday → 7
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() - (day - 1));
      return monday.toISOString();
    }
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }, [period]);

  const historyQ = useQuery<Booking[]>(
    ['runner', 'earnings', 'history', period, userId],
    async () =>
      ((await runnerService.getEarningsHistory({ page: 1, per_page: 30, date_from: dateFrom })).data.data ?? []) as Booking[],
    { staleTime: 60_000, ttl: CacheTTL.MEDIUM },
  );

  const earningsData = summaryQ.data ?? null;
  const earningsList = historyQ.data ?? [];

  // Group rows by calendar day with a per-day subtotal so the runner can
  // see e.g. "Tuesday: ₱1,240" without manually adding rows together.
  const earningsByDay = useMemo(() => {
    if (!earningsList.length) return [];
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const groups = new Map<string, { label: string; total: number; errands: Booking[]; sortKey: number }>();
    for (const errand of earningsList) {
      const ts = new Date(errand.completed_at ?? errand.created_at);
      const dayKey = `${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}`;
      const dayStart = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()).getTime();
      let label: string;
      if (dayStart === startOfToday) label = 'Today';
      else if (dayStart === startOfYesterday) label = 'Yesterday';
      else label = ts.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      const amount = errand.runner_payout ?? errand.total_amount ?? 0;
      const existing = groups.get(dayKey);
      if (existing) {
        existing.total += amount;
        existing.errands.push(errand);
      } else {
        groups.set(dayKey, { label, total: amount, errands: [errand], sortKey: dayStart });
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.sortKey - a.sortKey);
  }, [earningsList]);

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
    <View className="flex-1 bg-background">
      <GradientHeader title="Earnings" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Hero Card — premium dark fintech treatment.
            Previous version was a flat solid blue panel; the runner kept
            confusing it with the brand's primary CTA. Slate-900 reads as
            "trustworthy money" and lets the amount be the loudest thing
            on screen. */}
        <View
          className="mx-5 mb-4 rounded-3xl p-6 overflow-hidden"
          style={{
            backgroundColor: '#0F172A',
            shadowColor: '#0F172A',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 20,
            elevation: 6,
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -50,
              right: -40,
              width: 170,
              height: 170,
              borderRadius: 85,
              backgroundColor: '#22C55E',
              opacity: 0.18,
            }}
          />
          <Text className="text-xs font-montserrat-semi text-white/60 uppercase tracking-wider">
            {periodLabel[period]}
          </Text>
          <Text className="text-4xl font-inter-semi tabular-nums text-white mt-1">
            {formatCurrency(earningsData?.total_earnings ?? 0)}
          </Text>
          <View className="flex-row items-center mt-3">
            <View className="bg-white/10 px-2.5 py-1 rounded-md">
              <Text className="text-[11px] font-montserrat-semi text-white">
                {earningsData?.total_errands ?? 0} errands
              </Text>
            </View>
            <View className="bg-white/10 px-2.5 py-1 rounded-md ml-2">
              <Text className="text-[11px] font-montserrat-semi text-white">
                Avg {formatCurrency(earningsData?.avg_per_errand ?? 0)}
              </Text>
            </View>
          </View>
        </View>

        {/* Period Selector — underline-style tab strip. Less rounded,
            no nested pills, no background fills. The active tab
            communicates state with weight + a 2px brand underline. */}
        <View className="flex-row mx-5 mb-5 border-b border-divider">
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              accessibilityRole="tab"
              accessibilityState={{ selected: period === p }}
              hitSlop={6}
              className="pr-5 pb-2.5 -mb-px"
              style={period === p ? { borderBottomWidth: 2, borderBottomColor: '#2563EB' } : undefined}
            >
              <Text
                className={`text-[13px] ${
                  period === p
                    ? 'font-montserrat-bold text-textPrimary'
                    : 'font-montserrat-semi text-textSecondary'
                }`}
              >
                {p === 'today' ? 'Today' : p === 'week' ? 'This week' : 'This month'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Breakdown — typographic key/value rows, no card chrome,
            bounded by a subtle hairline above and below. */}
        <View className="mx-5 mb-6 py-2 border-y border-divider">
          <View className="flex-row items-center justify-between py-2">
            <Text className="text-[13px] font-montserrat text-textSecondary">Total errands</Text>
            <Text className="text-[14px] font-inter-semi tabular-nums text-textPrimary">
              {earningsData?.total_errands ?? 0}
            </Text>
          </View>
          <Hairline />
          <View className="flex-row items-center justify-between py-2">
            <Text className="text-[13px] font-montserrat text-textSecondary">Avg per errand</Text>
            <Text className="text-[14px] font-inter-semi tabular-nums text-textPrimary">
              {formatCurrency(earningsData?.avg_per_errand ?? 0)}
            </Text>
          </View>
          <Hairline />
          <View className="flex-row items-center justify-between py-2">
            <Text className="text-[14px] font-montserrat-bold text-textPrimary">Total</Text>
            <Text className="text-[16px] font-inter-semi tabular-nums text-primary">
              {formatCurrency(earningsData?.total_earnings ?? 0)}
            </Text>
          </View>
        </View>

        {/* Per-Errand Earnings List — hairline rows grouped by day. */}
        <View className="px-5 mb-6">
          <Eyebrow className="mb-2">Per-errand</Eyebrow>
          {earningsList.length === 0 ? (
            <View className="py-6">
              <Text className="text-[13px] font-montserrat text-textSecondary">
                No earnings yet for this period.
              </Text>
            </View>
          ) : (
            earningsByDay.map((group) => (
              <View key={group.label} className="mb-4">
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary" style={{ letterSpacing: 1.2 }}>
                    {group.label}
                  </Text>
                  <Text className="text-[11px] font-inter-semi tabular-nums text-textSecondary">
                    {formatCurrency(group.total)}
                  </Text>
                </View>
                {group.errands.map((errand, idx) => (
                  <View key={errand.id}>
                    <View className="flex-row items-center justify-between py-3">
                      <View className="flex-1 mr-2">
                        <Text className="text-[14px] font-montserrat-bold text-textPrimary" numberOfLines={1}>
                          {errand.errand_type?.name ?? 'Errand'}
                        </Text>
                        <Text className="text-[11px] font-inter tabular-nums text-textMuted mt-0.5">
                          {new Date(errand.completed_at ?? errand.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </View>
                      <Text className="text-[14px] font-inter-semi tabular-nums text-textPrimary">
                        {formatCurrency(errand.runner_payout ?? errand.total_amount)}
                      </Text>
                    </View>
                    {idx < group.errands.length - 1 && <Hairline />}
                  </View>
                ))}
              </View>
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
    </View>
  );
}
