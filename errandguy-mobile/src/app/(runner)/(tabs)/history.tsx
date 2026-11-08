import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
} from 'react-native';
import { Search, X, MessageCircle, ClipboardList, SearchX, RefreshCw } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Card } from '../../../components/ui/Card';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { SyncIndicator } from '../../../components/ui/SyncIndicator';
import { SlowNetworkNotice } from '../../../components/ui/SlowNetworkNotice';
import { RunnerEmptyState } from '../../../components/ui/RunnerEmptyState';
import { Illustration } from '../../../components/ui/Illustration';
import { ErrorState } from '../../../components/ui/ErrorState';
import { runnerService } from '../../../services/runner.service';
import { prefetchRunnerErrand } from '../../../services/preload.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { formatRunnerPayout } from '../../../utils/runnerPayout';
import { formatMonthDay } from '../../../utils/formatDate';
import { earnedLabel } from '../../../components/runner/errandEarnings';
import { useDebounce } from '../../../hooks/useDebounce';
import { useHideTabBarOnScroll } from '../../../hooks/useHideTabBarOnScroll';
import { HistorySkeleton } from '../../../components/ui/Skeleton';
import type { Booking } from '../../../types';
import { LightColors } from '../../../constants/colors';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';

/** Next searches to offer when one finds nothing (pattern 6) — the errand
 *  types the server matches a term against. */
const SEARCH_SUGGESTIONS = ['Delivery', 'Buy for me', 'Queue'];

export default function HistoryScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const chatUnread = useChatStore((s) => s.unreadCount);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const hideOnScroll = useHideTabBarOnScroll();

  // Page 1 is cached via useQuery (cache-first); subsequent pages append.
  // Search is a SERVER param, and part of the cache key so a new term refetches.
  // It used to be a client-side filter over the loaded pages only, so a runner
  // searching for an errand from three months ago was told "No matches" while
  // the record sat unfetched on page 12 — with the empty state advising them to
  // search by booking number, the exact thing that couldn't work.
  const page1Q = useQuery<Booking[]>(
    ['runner', 'errands', 'history', statusFilter, debouncedSearch.trim(), userId],
    async () => {
      const params: Record<string, any> = { page: 1, per_page: 15 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
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
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  // Reset pagination when the filter OR the search term changes.
  //
  // The search term belongs here now that it is a server param: without it,
  // searching "Ana", scrolling to load page 2, then changing the term to "Ben"
  // would refetch page 1 for Ben while page 2 of Ana's results stayed appended
  // below it — a list quietly mixing results from two different searches.
  // Which list is showing. A change (filter, or the trimmed term) starts it
  // over, and a page requested for an earlier list is dropped when it lands.
  const listKey = `${statusFilter}|${debouncedSearch.trim()}`;
  // Bumped whenever the list starts over (new filter/term, pull-to-refresh),
  // so a page requested before that is dropped when it lands.
  const listGeneration = useRef(0);

  useEffect(() => {
    listGeneration.current += 1;
    setExtraPages([]);
    setPage(1);
    setHasMore(true);
    setLoadMoreFailed(false);
  }, [listKey]);

  // Page 1 can be refetched behind the runner's back (back on the tab, the
  // app returning after a while, an errand finishing). If its first row
  // changed, the rows shifted: older pages already appended sit at the old
  // offsets — a row shown twice, or one that never shows — and a page still in
  // the air was asked for at those offsets too. Start the older pages over.
  //
  // Page 1 only decides whether there is more while it is the only page. Once
  // older pages are loaded the last of them decides; a refetch of page 1 used
  // to re-arm a list that had already reached its end.
  const firstRowId = page1Q.data?.[0]?.id ?? null;
  const lastFirstRowId = useRef<string | null>(null);
  useEffect(() => {
    const shifted = lastFirstRowId.current !== null && firstRowId !== lastFirstRowId.current;
    lastFirstRowId.current = firstRowId;
    if (shifted) {
      listGeneration.current += 1;
      setExtraPages([]);
      setPage(1);
      setLoadMoreFailed(false);
    }
    if (page1Q.data && (shifted || extraPages.length === 0)) {
      setHasMore((page1Q.data.length ?? 0) >= 15);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page1Q.data]);

  const errands = useMemo(
    () => [...(page1Q.data ?? []), ...extraPages],
    [page1Q.data, extraPages],
  );
  const initialLoading = page1Q.loading && !page1Q.data;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    listGeneration.current += 1;
    setExtraPages([]);
    setPage(1);
    setHasMore(true);
    setLoadMoreFailed(false);
    await page1Q.refresh();
    setRefreshing(false);
  }, [page1Q]);

  const fetchNextPage = useCallback(async () => {
    setLoadingMore(true);
    setLoadMoreFailed(false);
    const nextPage = page + 1;
    const requestedFor = listGeneration.current;
    try {
      const params: Record<string, any> = { page: nextPage, per_page: 15 };
      if (statusFilter !== 'all') params.status = statusFilter;
      // Must carry the term too — without it page 2 of a search returns
      // unfiltered rows and the list silently mixes matches with non-matches.
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const res = await runnerService.getErrandHistory(params);
      if (listGeneration.current !== requestedFor) return;
      const data: Booking[] = res.data.data ?? [];
      setExtraPages((prev) => [...prev, ...data]);
      setPage(nextPage);
      setHasMore(data.length >= 15);
    } catch {
      // Surface an inline retry in the footer instead of a transient
      // toast — the list silently stopping mid-scroll is confusing.
      if (listGeneration.current === requestedFor) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
    // debouncedSearch: page 2 of a search must be fetched with the CURRENT
    // term (it was missing, so a changed search loaded the old term's rows).
  }, [page, statusFilter, debouncedSearch]);

  const onEndReached = useCallback(() => {
    // After a failure, wait for an explicit retry tap — otherwise the
    // scroll position keeps re-triggering the failing request.
    if (!hasMore || loadingMore || loadMoreFailed) return;
    fetchNextPage();
  }, [hasMore, loadingMore, loadMoreFailed, fetchNextPage]);

  // No client-side filtering: the server already applied the term across the
  // WHOLE history. Re-filtering here would be worse than redundant — the server
  // also matches the customer's name, which this list never had, so a local
  // pass would hide legitimate matches it couldn't see.
  const filteredErrands = errands;

  const searchActive = debouncedSearch.trim().length > 0;
  // Distinguish "page 1 fetch failed" from a genuinely empty history —
  // showing 'No completed errands' over a network error is misleading.
  const page1Failed = !!page1Q.error && !page1Q.data;

  const renderItem = useCallback(
    ({ item }: { item: Booking }) => {
      const isCompleted = item.status === 'completed';
      // The app's own formatter, not the device locale: a 24h/European-locale
      // phone rendered "3 Nov" here beside "Nov 3" everywhere else.
      const dateStr = formatMonthDay(item.completed_at ?? item.created_at);
      return (
        <Card
          className="mx-5 mb-3"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            // History rows navigate cold otherwise — warm the detail cache on
            // tap so the errand screen paints from cache, not a skeleton (P24).
            prefetchRunnerErrand(item.id);
            router.push(`/(runner)/errand/${item.id}` as any);
          }}
          accessibilityLabel={`${item.errand_type?.name ?? 'Errand'}, ${isCompleted ? 'Completed' : 'Cancelled'}, ${dateStr}, ${isCompleted ? formatRunnerPayout(item.runner_payout) : `you earned ${earnedLabel(item)}`}`}
          accessibilityHint="Opens errand details"
        >
          {/* Top row — type + status chip left, date + fare right */}
          <View className="flex-row items-start mb-3">
            <View className="flex-1 pr-3">
              <Text
                className="text-[14px] font-montserrat-bold text-textPrimary"
                numberOfLines={1}
              >
                {item.errand_type?.name ?? 'Errand'}
              </Text>
              {/* Status chip — *Dark text on a soft wash so Completed and
                  Cancelled read as equal-weight AA chips (Badge's base
                  tones fall under AA below 17px). Only on "All": under a
                  Completed/Cancelled filter it would repeat the tab. */}
              {statusFilter === 'all' ? (
              <View
                className={`self-start rounded-full px-2 py-0.5 mt-1 ${
                  isCompleted ? 'bg-successSoft' : 'bg-dangerSoft'
                }`}
              >
                <Text
                  className={`text-[11px] font-montserrat-bold ${
                    isCompleted ? 'text-successDark' : 'text-dangerDark'
                  }`}
                >
                  {isCompleted ? 'Completed' : 'Cancelled'}
                </Text>
              </View>
              ) : null}
            </View>
            <View className="items-end">
              <Text className="text-[12px] font-montserrat tabular-nums text-textSecondary">
                {dateStr}
              </Text>
              <Text
                className={`text-[16px] font-inter-semi tabular-nums mt-0.5 ${
                  isCompleted ? 'text-textPrimary' : 'text-textSecondary'
                }`}
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {/* A cancelled errand shows what it actually paid — the
                    cancellation fee, or ₱0.00 — never the payout it would
                    have earned. */}
                {isCompleted ? formatRunnerPayout(item.runner_payout) : earnedLabel(item)}
              </Text>
            </View>
          </View>

          {/* Route — pickup/dropoff timeline beads */}
          <View className="flex-row">
            <View className="items-center mr-3" style={{ width: 10 }}>
              <View className="w-2.5 h-2.5 rounded-full border-2 border-primary bg-surface mt-1" />
              {item.dropoff_address ? (
                <>
                  <View
                    className="flex-1 my-0.5"
                    style={{
                      width: 1,
                      borderLeftWidth: 1,
                      borderStyle: 'dashed',
                      borderLeftColor: LightColors.dividerStrong,
                    }}
                  />
                  <View className="w-2.5 h-2.5 rounded-full bg-primary mb-1" />
                </>
              ) : null}
            </View>
            <View className="flex-1">
              <Text
                className="text-[12px] font-montserrat text-textSecondary"
                numberOfLines={1}
              >
                {item.pickup_address}
              </Text>
              {item.dropoff_address ? (
                <Text
                  className="text-[12px] font-montserrat text-textSecondary mt-2"
                  numberOfLines={1}
                >
                  {item.dropoff_address}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
      );
    },
    [router, statusFilter],
  );

  if (initialLoading) {
    return (
      <View className="flex-1 bg-background">
        {/* Keep the same header chrome (incl. the Messages button) mounted
            during the first fetch so it doesn't pop in when data lands. */}
        <GradientHeader
          title="Errands"
          trailing={{
            icon: MessageCircle,
            onPress: () => router.push('/(runner)/chat' as any),
            badge: chatUnread,
            accessibilityLabel: chatUnread > 0 ? `${chatUnread} unread messages` : 'Messages',
          }}
        />
        <HistorySkeleton />
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 20, right: 20, bottom: TAB_CONTENT_BOTTOM_INSET }}
        >
          <SlowNetworkNotice loading={initialLoading} onRetry={() => page1Q.refresh()} />
        </View>
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

      {/* The pill pads itself 10pt; nudge it so its text lines up with the
          search field's left edge. */}
      <SyncIndicator
        syncing={page1Q.isStale}
        updatedAt={page1Q.updatedAt}
        error={!!page1Q.error}
        offline={!!page1Q.servedFromCacheOffline}
        onRetry={page1Q.refresh}
        style={{ marginLeft: 10 }}
      />

      {/* Search — thin underline input, no card */}
      <View className="px-5 mb-2">
        <View
          className="flex-row items-center border-b border-divider"
          style={{ minHeight: 44 }}
        >
          <Search size={16} color={LightColors.textSecondary} strokeWidth={2} />
          <TextInput
            className="flex-1 ml-2 text-[14px] font-montserrat text-textPrimary"
            placeholder="Search errands"
            placeholderTextColor={LightColors.textMuted}
            accessibilityLabel="Search errands by booking number, address, or type"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 ? (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSearch('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              className="ml-2 p-1"
            >
              <X size={16} color={LightColors.textSecondary} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Status Filters — underline tabs (no pills) */}
      <View className="flex-row px-5 mb-1 border-b border-divider">
        {(['all', 'completed', 'cancelled'] as const).map((s) => {
          const active = statusFilter === s;
          return (
            <Pressable
              key={s}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setStatusFilter(s);
              }}
              className="pr-5 pb-2.5 -mb-px"
              style={active ? { borderBottomWidth: 2, borderBottomColor: LightColors.primary } : undefined}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              // Row content is ~26pt tall — extend to a >=44pt target.
              hitSlop={{ top: 12, bottom: 8, left: 6, right: 6 }}
            >
              <Text
                className={`text-[13px] ${
                  active
                    ? 'font-montserrat-bold text-textPrimary'
                    : 'font-montserrat-semi text-textSecondary'
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
        {...hideOnScroll}
        data={filteredErrands}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        // flexGrow:1 lets the flex:1 empty/error states fill the viewport
        // and centre; harmless once real rows exceed the screen height.
        // paddingBottom reserves the attached tab bar's height + inset so the
        // last card (and the load-more footer) never hide behind it.
        contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingBottom: TAB_CONTENT_BOTTOM_INSET }}
        refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        ListEmptyComponent={
          page1Failed ? (
            <ErrorState
              error={page1Q.error}
              title="Couldn't load your errands"
              onRetry={() => page1Q.refresh()}
            />
          ) : searchActive ? (
            <RunnerEmptyState
              illustration={<Illustration name="empty-search" size={160} />}
              title={`No matches for “${debouncedSearch.trim()}”`}
              description="Search by booking number, address or errand type, or try one of these."
              actionLabel="Clear search"
              onAction={() => setSearch('')}
            >
              {/* Pattern 6 — a next search one tap away. */}
              <View className="flex-row flex-wrap justify-center mt-4" style={{ gap: 8 }}>
                {SEARCH_SUGGESTIONS.filter(
                  (s) => s.toLowerCase() !== debouncedSearch.trim().toLowerCase(),
                ).map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setSearch(s);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${s}`}
                    className="px-4 rounded-full border border-divider bg-surface items-center justify-center active:opacity-70"
                    style={{ minHeight: 44 }}
                  >
                    <Text className="text-[13px] font-montserrat-semi text-textPrimary">{s}</Text>
                  </Pressable>
                ))}
              </View>
            </RunnerEmptyState>
          ) : (
            <RunnerEmptyState
              illustration={<Illustration name="runner-offline" size={160} />}
              title={
                statusFilter === 'completed'
                  ? 'No completed errands yet'
                  : statusFilter === 'cancelled'
                    ? 'No cancelled errands'
                    : 'No errands yet'
              }
              description={
                statusFilter === 'cancelled'
                  ? 'Jobs you cancel or that fall through will appear here.'
                  : "Once you finish a job it'll show up here with its payout."
              }
              // One next step: back to all errands from an empty filter, or
              // Home (where the power button is) when there are none at all.
              actionLabel={statusFilter === 'cancelled' ? 'Show all errands' : 'Go online to get errands'}
              onAction={() =>
                statusFilter === 'cancelled'
                  ? setStatusFilter('all')
                  : router.push('/(runner)/(tabs)' as any)
              }
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center justify-center">
              <Text className="text-[12px] font-montserrat text-textSecondary">
                Loading more errands…
              </Text>
            </View>
          ) : loadMoreFailed ? (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                fetchNextPage();
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading more errands"
              className="mx-5 my-2 py-3 rounded-2xl border border-divider bg-surface flex-row items-center justify-center"
              style={{ minHeight: 44 }}
            >
              <RefreshCw size={16} color={LightColors.primary} strokeWidth={2} />
              <Text className="text-[13px] font-montserrat-bold text-primary ml-2">
                Couldn&apos;t load more · Tap to retry
              </Text>
            </Pressable>
          ) : !hasMore && filteredErrands.length > 0 ? (
            // End-of-list affordance (mirrors the notifications inbox) so a
            // fully-loaded history reads as finished, not mid-load.
            <View className="py-4 items-center">
              <Text className="text-[12px] font-montserrat text-textSecondary">
                That&apos;s all your errands
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
