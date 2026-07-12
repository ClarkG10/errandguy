import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrendingUp } from 'lucide-react-native';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { Card } from '../../components/ui/Card';
import { Eyebrow } from '../../components/ui/Typography';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Spinner } from '../../components/ui/Spinner';
import { BrandRefreshControl } from '../../components/ui/BrandRefreshControl';
import { HereMapView, HereHeatmap } from '../../components/map';
import { runnerService } from '../../services/runner.service';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';

interface HeatmapCell {
  lat: number;
  lng: number;
  weight: number;
}
interface HeatmapData {
  days: number;
  cells: HeatmapCell[];
}
interface PeakHoursData {
  days: number;
  /** grid[dow 0=Sun..6=Sat][hour 0..23] booking counts. */
  grid: number[][];
}

// Metro Manila fallback when there are no cells to frame the map on.
const DEFAULT_REGION = {
  latitude: 14.5995,
  longitude: 120.9842,
  latitudeDelta: 0.18,
  longitudeDelta: 0.18,
};

// Display order — Monday first (matches the earnings weekly chart) while the
// backend grid is indexed 0=Sun..6=Sat.
const DAY_ROWS: { dow: number; label: string; full: string }[] = [
  { dow: 1, label: 'Mon', full: 'Monday' },
  { dow: 2, label: 'Tue', full: 'Tuesday' },
  { dow: 3, label: 'Wed', full: 'Wednesday' },
  { dow: 4, label: 'Thu', full: 'Thursday' },
  { dow: 5, label: 'Fri', full: 'Friday' },
  { dow: 6, label: 'Sat', full: 'Saturday' },
  { dow: 0, label: 'Sun', full: 'Sunday' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const CELL_W = 13;
const CELL_H = 18;
const CELL_GAP = 2;
const LABEL_W = 34;

/** Compact 12-hour clock label, e.g. `12a`, `6a`, `12p`, `6p`. */
function hourLabel(h: number): string {
  const suffix = h < 12 ? 'a' : 'p';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${suffix}`;
}

/** Full readable hour range for an a11y label, e.g. `2pm`. */
function hourA11y(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${suffix}`;
}

/** Blend the brand blue with an alpha so darker == busier. */
function densityColor(count: number, max: number): string {
  if (count <= 0) return LightColors.divider;
  const t = max > 0 ? count / max : 0;
  const alpha = 0.18 + 0.82 * t;
  const hex = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${LightColors.primary}${hex}`;
}

function DemandSkeleton() {
  return (
    <View className="px-5 pt-1">
      <Skeleton width="40%" height={12} style={{ marginBottom: 10 }} />
      <Skeleton width="100%" height={280} borderRadius={16} style={{ marginBottom: 24 }} />
      <Skeleton width="45%" height={12} style={{ marginBottom: 10 }} />
      <Skeleton width="100%" height={200} borderRadius={16} />
    </View>
  );
}

export default function DemandScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();

  const heatmapQ = useQuery<HeatmapData>(
    ['runner', 'heatmap', 14],
    async () => (await runnerService.getHeatmap(14)).data.data,
    { staleTime: CacheTTL.MEDIUM, ttl: CacheTTL.LONG },
  );
  const peakQ = useQuery<PeakHoursData>(
    ['runner', 'peak-hours', 30],
    async () => (await runnerService.getPeakHours(30)).data.data,
    { staleTime: CacheTTL.MEDIUM, ttl: CacheTTL.LONG },
  );

  const cells = heatmapQ.data?.cells ?? [];
  const grid = peakQ.data?.grid ?? null;

  const initialLoading =
    (heatmapQ.loading && !heatmapQ.data) || (peakQ.loading && !peakQ.data);
  const bothFailed =
    !!heatmapQ.error && !heatmapQ.data && !!peakQ.error && !peakQ.data;

  const region = useMemo(() => {
    if (cells.length === 0) return DEFAULT_REGION;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const c of cells) {
      minLat = Math.min(minLat, c.lat);
      maxLat = Math.max(maxLat, c.lat);
      minLng = Math.min(minLng, c.lng);
      maxLng = Math.max(maxLng, c.lng);
    }
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.5),
      longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.5),
    };
  }, [cells]);

  // Busiest day/hour slot for the headline caption.
  const peakInsight = useMemo(() => {
    if (!grid) return null;
    let best = { dow: -1, hour: -1, count: 0 };
    for (let d = 0; d < grid.length; d++) {
      const row = grid[d] ?? [];
      for (let h = 0; h < row.length; h++) {
        if (row[h] > best.count) best = { dow: d, hour: h, count: row[h] };
      }
    }
    if (best.count <= 0) return null;
    const day = DAY_ROWS.find((r) => r.dow === best.dow);
    return day ? `Busiest around ${day.full} ${hourA11y(best.hour)}` : null;
  }, [grid]);

  const gridMax = useMemo(() => {
    if (!grid) return 0;
    let m = 0;
    for (const row of grid) for (const c of row) if (c > m) m = c;
    return m;
  }, [grid]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([heatmapQ.refresh(), peakQ.refresh()]);
    setRefreshing(false);
  }, [heatmapQ, peakQ]);

  const retryAll = useCallback(() => {
    heatmapQ.refresh();
    peakQ.refresh();
  }, [heatmapQ, peakQ]);

  if (initialLoading) {
    return (
      <View className="flex-1 bg-background">
        <GradientHeader title="Busy areas" showBack fallbackHref="/(runner)/(tabs)" />
        <DemandSkeleton />
      </View>
    );
  }

  if (bothFailed) {
    return (
      <View className="flex-1 bg-background">
        <GradientHeader title="Busy areas" showBack fallbackHref="/(runner)/(tabs)" />
        <ErrorState title="Couldn't load demand data" onRetry={retryAll} />
      </View>
    );
  }

  const heatmapFailed = !!heatmapQ.error && !heatmapQ.data;
  const peakFailed = !!peakQ.error && !peakQ.data;

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Busy areas" showBack fallbackHref="/(runner)/(tabs)" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          paddingBottom: insets.bottom + 24,
        }}
      >
        {/* ── Demand heatmap ── */}
        <View className="px-5 pt-1 mb-6">
          <Eyebrow className="mb-2">Where bookings happen</Eyebrow>
          {heatmapFailed ? (
            <Card padding="lg">
              <ErrorState
                compact
                title="Couldn't load the map"
                onRetry={() => heatmapQ.refresh()}
              />
            </Card>
          ) : (
            <View
              className="rounded-2xl overflow-hidden border border-divider"
              style={{ height: 280 }}
            >
              {cells.length > 0 ? (
                <View className="flex-1">
                  <HereMapView
                    style={{ flex: 1 }}
                    initialRegion={region}
                    rotateEnabled={false}
                    pitchEnabled={false}
                    maxZoomLevel={15}
                    onMapReady={() => setMapReady(true)}
                  >
                    <HereHeatmap id="demand-heatmap" cells={cells} />
                  </HereMapView>
                  {/* Veil the raw tile checkerboard until the first paint —
                      the skeleton is already gone by the time we mount. */}
                  {!mapReady && (
                    <View className="absolute inset-0 bg-surfaceMuted items-center justify-center">
                      <Spinner size="small" color={LightColors.primary} />
                    </View>
                  )}
                </View>
              ) : (
                <View className="flex-1 bg-surfaceMuted items-center justify-center px-6">
                  <TrendingUp size={30} color={LightColors.textMuted} />
                  <Text className="text-sm font-montserrat text-textSecondary mt-2 text-center">
                    Not enough recent bookings to map yet. Check back soon.
                  </Text>
                </View>
              )}
            </View>
          )}
          {cells.length > 0 && (
            <Text className="text-[12px] font-montserrat text-textTertiary mt-2">
              Warmer areas had more bookings in the last {heatmapQ.data?.days ?? 14} days.
            </Text>
          )}
        </View>

        {/* ── Peak hours grid ── */}
        <View className="px-5">
          <Eyebrow className="mb-2">Peak hours</Eyebrow>
          {peakInsight && (
            <View className="flex-row items-center mb-3">
              <TrendingUp size={16} color={LightColors.primary} />
              <Text className="text-[15px] font-montserrat-bold text-textPrimary ml-1.5">
                {peakInsight}
              </Text>
            </View>
          )}
          <Card padding="lg">
            {peakFailed ? (
              <ErrorState
                compact
                title="Couldn't load peak hours"
                onRetry={() => peakQ.refresh()}
              />
            ) : !grid || gridMax <= 0 ? (
              <View className="items-center justify-center py-6">
                <Text className="text-sm font-montserrat text-textSecondary text-center">
                  No booking history yet to show peak hours.
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                persistentScrollbar={Platform.OS === 'android'}
                contentContainerStyle={{ paddingBottom: 4 }}
              >
                <View>
                  {/* Hour axis */}
                  <View className="flex-row" style={{ marginLeft: LABEL_W, marginBottom: 4 }}>
                    {HOURS.map((h) => (
                      <View
                        key={h}
                        style={{ width: CELL_W + CELL_GAP, alignItems: 'center' }}
                      >
                        {h % 6 === 0 ? (
                          // Fixed width wider than the cell so the 12px label
                          // centres over its column and overflows into the
                          // empty 6h-gap neighbours rather than truncating.
                          <Text
                            numberOfLines={1}
                            style={{ width: 34, textAlign: 'center' }}
                            className="text-[12px] font-montserrat text-textTertiary"
                          >
                            {hourLabel(h)}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>

                  {/* One row per day */}
                  {DAY_ROWS.map((day) => {
                    const row = grid[day.dow] ?? [];
                    return (
                      <View key={day.dow} className="flex-row items-center" style={{ marginBottom: CELL_GAP }}>
                        <Text
                          className="text-[12px] font-montserrat-semi text-textSecondary"
                          style={{ width: LABEL_W }}
                        >
                          {day.label}
                        </Text>
                        {HOURS.map((h) => {
                          const count = row[h] ?? 0;
                          // Only busy cells are screen-reader stops — the
                          // peak-insight headline already summarises the rest,
                          // so we don't flood SR with ~80 empty '0 bookings'.
                          const hasDemand = count > 0;
                          return (
                            <View
                              key={h}
                              accessible={hasDemand}
                              accessibilityElementsHidden={!hasDemand}
                              importantForAccessibility={hasDemand ? 'yes' : 'no-hide-descendants'}
                              accessibilityLabel={
                                hasDemand
                                  ? `${day.full} ${hourA11y(h)}: ${count} bookings`
                                  : undefined
                              }
                              style={{
                                width: CELL_W,
                                height: CELL_H,
                                marginRight: CELL_GAP,
                                borderRadius: 3,
                                backgroundColor: densityColor(count, gridMax),
                              }}
                            />
                          );
                        })}
                      </View>
                    );
                  })}

                  {/* Legend */}
                  <View
                    className="flex-row items-center"
                    style={{ marginLeft: LABEL_W, marginTop: 8 }}
                  >
                    <Text className="text-[12px] font-montserrat text-textTertiary mr-1">Less</Text>
                    {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                      <View
                        key={t}
                        style={{
                          width: CELL_W,
                          height: 10,
                          marginRight: CELL_GAP,
                          borderRadius: 2,
                          backgroundColor: densityColor(t * gridMax, gridMax),
                        }}
                      />
                    ))}
                    <Text className="text-[12px] font-montserrat text-textTertiary ml-1">More</Text>
                  </View>
                </View>
              </ScrollView>
            )}
          </Card>
          {grid && gridMax > 0 && (
            <Text className="text-[12px] font-montserrat text-textTertiary mt-2">
              Based on the last {peakQ.data?.days ?? 30} days of bookings.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
