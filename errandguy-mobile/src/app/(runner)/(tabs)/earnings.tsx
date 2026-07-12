import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Wallet, Download, FileText } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { RunnerEmptyState } from '../../../components/ui/RunnerEmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { Eyebrow, Hairline } from '../../../components/ui/Typography';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { SyncIndicator } from '../../../components/ui/SyncIndicator';
import { useResponsive } from '../../../constants/responsive';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { secureStorage } from '../../../utils/storage';
import { toast } from '../../../stores/toastStore';
import type { Booking } from '../../../types';
import { LightColors, Elevation } from '../../../constants/colors';

type Period = 'today' | 'week' | 'month';

/** Server period slug matching RunnerEarningsController / ExportController. */
const API_PERIOD: Record<Period, string> = {
  today: 'today',
  week: 'this_week',
  month: 'this_month',
};

/** RFC-4180-ish escaping: wrap in quotes and double any embedded quotes. */
const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Build a CSV (date, errand type, payout) from the loaded earnings rows. */
function buildEarningsCsv(rows: Booking[]): string {
  const header = ['Date', 'Errand type', 'Payout'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const date = new Date(r.completed_at ?? r.created_at).toISOString();
    const type = r.errand_type?.name ?? 'Errand';
    const payout = r.runner_payout ?? r.total_amount ?? 0;
    lines.push([csvCell(date), csvCell(type), csvCell(payout)].join(','));
  }
  return lines.join('\n');
}

interface EarningsData {
  total_earnings: number;
  total_errands: number;
  avg_per_errand: number;
}

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Ultra-compact peso amount for the tiny labels above chart bars. */
const compactAmount = (v: number) =>
  v >= 1000 ? `₱${(v / 1000).toFixed(1)}K` : `₱${Math.round(v)}`;

/** First-load placeholder — mirrors the screen's real layout the same
 *  way RunnerHomeSkeleton mirrors the dashboard. */
function EarningsSkeleton() {
  return (
    <View className="flex-1 px-5 pt-1">
      {/* Hero balance card */}
      <Skeleton width="100%" height={148} borderRadius={24} style={{ marginBottom: 16 }} />
      {/* Period tabs */}
      <View className="flex-row mb-5" style={{ gap: 16 }}>
        {[56, 72, 84].map((w, i) => (
          <Skeleton key={i} width={w} height={16} />
        ))}
      </View>
      {/* Breakdown card */}
      <Skeleton width="100%" height={128} borderRadius={16} style={{ marginBottom: 24 }} />
      {/* Daily-breakdown chart card (default period is 'week') */}
      <Skeleton width="35%" height={12} style={{ marginBottom: 8 }} />
      <Skeleton width="100%" height={120} borderRadius={16} style={{ marginBottom: 24 }} />
      {/* Per-errand rows */}
      <Skeleton width="30%" height={12} style={{ marginBottom: 14 }} />
      {[1, 2, 3, 4].map((i) => (
        <View key={i} className="flex-row items-center justify-between py-3">
          <View style={{ flex: 1, marginRight: 12 }}>
            <Skeleton width="55%" height={14} style={{ marginBottom: 6 }} />
            <Skeleton width="30%" height={10} />
          </View>
          <Skeleton width={64} height={14} />
        </View>
      ))}
      {/* Payout CTA + export block — reserve the below-the-fold space */}
      <Skeleton width="100%" height={52} borderRadius={14} style={{ marginTop: 12, marginBottom: 16 }} />
      <Skeleton width="25%" height={12} style={{ marginBottom: 8 }} />
      <View className="flex-row" style={{ gap: 12 }}>
        <Skeleton width="48%" height={48} borderRadius={14} />
        <Skeleton width="48%" height={48} borderRadius={14} />
      </View>
    </View>
  );
}

export default function EarningsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const { contentMaxWidth } = useResponsive();

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

  // per_page must comfortably cover the whole window: a busy runner can
  // clear 30 errands in a couple of days, and a truncated page-1 both
  // undercounts the day-group subtotals AND leaves early weekdays out
  // of the chart (history is sorted newest-first, so the oldest days
  // are the ones that get cut).
  const perPage = period === 'today' ? 50 : 100;
  const historyQ = useQuery<Booking[]>(
    ['runner', 'earnings', 'history', period, userId],
    async () =>
      ((await runnerService.getEarningsHistory({ page: 1, per_page: perPage, date_from: dateFrom })).data.data ?? []) as Booking[],
    { staleTime: 60_000, ttl: CacheTTL.MEDIUM },
  );

  const earningsData = summaryQ.data ?? null;
  const earningsList = historyQ.data ?? [];

  const initialLoading =
    (summaryQ.loading && !summaryQ.data) || (historyQ.loading && !historyQ.data);
  const summaryFailed = !!summaryQ.error && !summaryQ.data;
  const historyFailed = !!historyQ.error && !historyQ.data;

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

  // Mon–Sun columns for the weekly bar chart. Built from the same rows
  // as earningsByDay but zero-filled across all 7 days so quiet days
  // read as gaps rather than disappearing.
  const weekChart = useMemo(() => {
    if (period !== 'week') return null;
    const now = new Date();
    const monday = new Date(now);
    const dow = monday.getDay() || 7; // Sunday → 7
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - (dow - 1));
    const totals = [0, 0, 0, 0, 0, 0, 0];
    for (const errand of earningsList) {
      const ts = new Date(errand.completed_at ?? errand.created_at);
      const dayStart = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
      const idx = Math.round((dayStart.getTime() - monday.getTime()) / 86_400_000);
      if (idx >= 0 && idx < 7) {
        totals[idx] += errand.runner_payout ?? errand.total_amount ?? 0;
      }
    }
    const max = Math.max(...totals);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayIdx = Math.round((todayStart.getTime() - monday.getTime()) / 86_400_000);
    const bestIdx = max > 0 ? totals.indexOf(max) : -1;
    return { totals, max, bestIdx, todayIdx };
  }, [period, earningsList]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([summaryQ.refresh(), historyQ.refresh()]);
    setRefreshing(false);
  }, [summaryQ, historyQ]);

  const retryAll = useCallback(() => {
    summaryQ.refresh();
    historyQ.refresh();
  }, [summaryQ, historyQ]);

  const selectPeriod = useCallback((p: Period) => {
    Haptics.selectionAsync().catch(() => {});
    setPeriod(p);
  }, []);

  // Which export is in flight (disables both actions + shows a spinner).
  const [exporting, setExporting] = useState<null | 'csv' | 'pdf'>(null);

  // Primary export: build a CSV from the already-loaded rows and hand the
  // file to the OS share sheet (mirrors ImageLightbox's cache-file pattern).
  const handleExportCsv = useCallback(async () => {
    if (exporting) return;
    if (earningsList.length === 0) {
      toast.info('No earnings to export for this period.');
      return;
    }
    // The CSV is built from the loaded page (capped at perPage), while the
    // server PDF is complete — warn before sharing so the two exports don't
    // silently disagree with the hero total on a >perPage month.
    if (earningsList.length >= perPage) {
      toast.info(`CSV includes the most recent ${perPage} errands for this period.`);
    }
    setExporting('csv');
    try {
      const csv = buildEarningsCsv(earningsList);
      const path = `${FileSystem.cacheDirectory}earnings-${period}-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Share.share({ url: path, title: 'Earnings export' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast.error("Couldn't export your earnings. Please try again.");
    } finally {
      setExporting(null);
    }
  }, [exporting, earningsList, period]);

  // Secondary export: download the server-rendered PDF statement (authed)
  // to the cache dir, then share it. Period is forwarded so the PDF's figures
  // match the on-screen summary.
  const handleDownloadPdf = useCallback(async () => {
    if (exporting) return;
    setExporting('pdf');
    try {
      const token =
        secureStorage.peek('auth_token') ?? (await secureStorage.get('auth_token'));
      if (!token) {
        toast.error('Please sign in again to export.');
        return;
      }
      const base = process.env.EXPO_PUBLIC_API_URL ?? '';
      const url = `${base}/runner/earnings/export?period=${API_PERIOD[period]}`;
      const path = `${FileSystem.cacheDirectory}earnings-${period}-${Date.now()}.pdf`;
      const res = await FileSystem.downloadAsync(url, path, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status >= 400) throw new Error(`download failed: ${res.status}`);
      await Share.share({ url: res.uri, title: 'Earnings statement' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast.error("Couldn't download your PDF statement. Please try again.");
    } finally {
      setExporting(null);
    }
  }, [exporting, period]);

  const periodLabel: Record<Period, string> = {
    today: "Today's Earnings",
    week: "This Week's Earnings",
    month: "This Month's Earnings",
  };

  if (initialLoading) {
    return (
      <View className="flex-1 bg-background">
        <GradientHeader title="Earnings" />
        <EarningsSkeleton />
      </View>
    );
  }

  // Both sources down with nothing cached — a hero full of fake ₱0.00
  // reads as "you earned nothing", so take over the screen instead.
  if (summaryFailed && historyFailed) {
    return (
      <View className="flex-1 bg-background">
        <GradientHeader title="Earnings" />
        <ErrorState
          title="Couldn't load your earnings"
          onRetry={retryAll}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Earnings" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          paddingBottom: 24,
        }}
      >
        {/* Hero Card — brand blue gradient balance card (same language
            as the wallet / runner-home hero). White numerals are the
            loudest thing on screen. When the summary fetch failed with
            no cache, swap in an error card — a confident ₱0.00 would
            be a lie. */}
        {summaryFailed ? (
          <Card className="mx-5 mb-4" padding="lg">
            <ErrorState
              compact
              title="Couldn't load your summary"
              onRetry={() => summaryQ.refresh()}
            />
          </Card>
        ) : (
          <LinearGradient
            colors={[
              LightColors.gradientStart,
              LightColors.gradientMid,
              LightColors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              marginHorizontal: 20,
              marginBottom: 16,
              borderRadius: 24,
              padding: 24,
              ...Elevation.md,
            }}
          >
            <Text
              className="text-xs font-montserrat-semi text-white/90 uppercase"
              style={{ letterSpacing: 1.2 }}
            >
              {periodLabel[period]}
            </Text>
            <Text className="text-4xl font-inter-semi tabular-nums text-white mt-1">
              {formatCurrency(earningsData?.total_earnings ?? 0)}
            </Text>
            {/* Secondary stats — inline white text on the raw gradient
                (translucent chips lightened the local background and
                dragged the small white numerals under the AA floor).
                Numbers ride Inter tabular; the middot is decorative. */}
            <View className="flex-row items-center mt-3">
              <Text className="text-[13px] font-inter-semi tabular-nums text-white">
                {earningsData?.total_errands ?? 0}
              </Text>
              <Text className="text-[13px] font-montserrat text-white/85 ml-1">
                errands
              </Text>
              <Text className="text-[13px] font-montserrat text-white/50 mx-2">·</Text>
              <Text className="text-[13px] font-montserrat text-white/85">Avg</Text>
              <Text className="text-[13px] font-inter-semi tabular-nums text-white ml-1">
                {formatCurrency(earningsData?.avg_per_errand ?? 0)}
              </Text>
            </View>
          </LinearGradient>
        )}

        {/* Period Selector — underline-style tab strip. Less rounded,
            no nested pills, no background fills. The active tab
            communicates state with weight + a 2px brand underline. */}
        <View className="flex-row mx-5 mb-5 border-b border-divider">
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => selectPeriod(p)}
              accessibilityRole="tab"
              accessibilityState={{ selected: period === p }}
              // Row content is ~28pt tall — extend to a >=44pt target.
              hitSlop={{ top: 12, bottom: 8, left: 6, right: 6 }}
              className="pr-5 pb-2.5 -mb-px"
              style={period === p ? { borderBottomWidth: 2, borderBottomColor: LightColors.primary } : undefined}
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

        <View className="px-5 mb-4 -mt-1">
          <SyncIndicator
            syncing={summaryQ.isStale || historyQ.isStale}
            updatedAt={summaryQ.updatedAt}
            error={!!summaryQ.error}
            onRetry={onRefresh ?? summaryQ.refresh}
            align="flex-start"
          />
        </View>

        {/* (Removed the "Breakdown" card — it repeated the hero verbatim:
            total earnings, total errands and avg-per-errand are all already
            shown in the gradient hero above, so the card was a metric with
            no added purpose. The daily chart + per-errand list below carry
            the information the hero doesn't.) */}

        {/* Daily chart — 7 proportional bars (Mon–Sun), pure Views.
            Best day gets the full brand blue; other days ride at a
            muted tint so the peak reads instantly. */}
        {period === 'week' && weekChart && weekChart.max > 0 && (
          <View className="px-5 mb-6">
            <Eyebrow className="mb-2">Daily breakdown</Eyebrow>
            <Card padding="lg">
              <View className="flex-row items-end">
                {weekChart.totals.map((total, i) => {
                  const isBest = i === weekChart.bestIdx;
                  const isToday = i === weekChart.todayIdx;
                  const barHeight =
                    total > 0
                      ? Math.max(8, Math.round((total / weekChart.max) * 72))
                      : 3;
                  return (
                    <View
                      key={i}
                      className="flex-1 items-center"
                      accessible
                      accessibilityLabel={`${DAY_NAMES[i]}${isToday ? ', today' : ''}: ${formatCurrency(total)}${isBest ? ', best day' : ''}`}
                    >
                      {/* Color-independent best-day marker — a dot's
                          presence (not its hue) flags the peak, so it
                          survives color-blindness and sunlight. Reserved
                          for every column to keep the labels aligned. */}
                      <View style={{ height: 6, marginBottom: 2, justifyContent: 'center' }}>
                        {isBest && total > 0 && (
                          <View
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 2.5,
                              backgroundColor: LightColors.primaryDark,
                            }}
                          />
                        )}
                      </View>
                      <Text
                        className={`text-[12px] tabular-nums mb-1 ${
                          isBest
                            ? 'font-inter-bold text-primaryDark'
                            : 'font-inter-semi text-textSecondary'
                        }`}
                        numberOfLines={1}
                      >
                        {total > 0 ? compactAmount(total) : ' '}
                      </Text>
                      <View
                        style={{
                          width: 18,
                          height: barHeight,
                          borderRadius: 5,
                          backgroundColor:
                            total <= 0
                              ? LightColors.dividerStrong
                              : isBest
                                ? LightColors.primaryDark
                                : LightColors.primary500,
                        }}
                      />
                      <Text
                        className={`text-[12px] mt-1.5 ${
                          isToday
                            ? 'font-montserrat-bold text-primaryDark'
                            : 'font-montserrat-semi text-textSecondary'
                        }`}
                      >
                        {DAY_INITIALS[i]}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Card>
          </View>
        )}

        {/* Per-Errand Earnings List — hairline rows grouped by day. */}
        <View className="px-5 mb-6">
          <Eyebrow className="mb-2">Per-errand</Eyebrow>
          {historyFailed ? (
            <ErrorState
              compact
              title="Couldn't load your errands"
              onRetry={() => historyQ.refresh()}
              style={{ paddingVertical: 12 }}
            />
          ) : earningsList.length === 0 ? (
            <RunnerEmptyState
              icon={Wallet}
              eyebrow="This period"
              title="No earnings yet"
              description="Completed errands for this period will show up here."
              actionLabel="Go online to start earning"
              onAction={() => router.push('/(runner)/(tabs)' as any)}
            />
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
            variant="primary"
            onPress={() => router.push('/(runner)/payout' as any)}
            fullWidth
          />
        </View>

        {/* Export — CSV (primary, from loaded rows) + PDF statement (server). */}
        <View className="px-5 mb-4">
          <Eyebrow className="mb-2">Export</Eyebrow>
          <View className="flex-row" style={{ gap: 12 }}>
            <View className="flex-1">
              <Button
                title="Export CSV"
                variant="secondary"
                icon={Download}
                onPress={handleExportCsv}
                loading={exporting === 'csv'}
                loadingTitle="Preparing CSV…"
                disabled={exporting === 'pdf'}
                fullWidth
                accessibilityHint="Share a CSV of this period's earnings"
              />
            </View>
            <View className="flex-1">
              <Button
                title="Download PDF"
                variant="ghost"
                icon={FileText}
                onPress={handleDownloadPdf}
                loading={exporting === 'pdf'}
                loadingTitle="Preparing PDF…"
                disabled={exporting === 'csv'}
                fullWidth
                accessibilityHint="Download and share the PDF earnings statement"
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
