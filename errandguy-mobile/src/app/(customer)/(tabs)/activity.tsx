import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  TextInput,
} from 'react-native';
import { ClipboardList, MessageCircle, RefreshCw, Search, SearchX, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { bookingService } from '../../../services/booking.service';
import { useQuery } from '../../../hooks/useQuery';
import { useHideTabBarOnScroll } from '../../../hooks/useHideTabBarOnScroll';
import { CacheTTL } from '../../../services/cache.service';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { StatePanel } from '../../../components/customer/home/StatePanel';
import { SlowNetworkNotice } from '../../../components/ui/SlowNetworkNotice';
import { ErrorState } from '../../../components/ui/ErrorState';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { SyncIndicator } from '../../../components/ui/SyncIndicator';
import { RecentErrandItem } from '../../../components/customer/RecentErrandItem';
import { BookingDetailSheet } from '../../../components/customer/BookingDetailSheet';
import { ActivityListSkeleton } from '../../../components/ui/Skeleton';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { Eyebrow } from '../../../components/ui/Typography';
import type { Booking } from '../../../types';
import { scheduledWindowLabel } from '../../../utils/scheduledBooking';
import { LightColors } from '../../../constants/colors';
import {
  AWAITING_PAYMENT_LABEL,
  SCHEDULED_LABEL,
  STATUS_LABELS,
} from '../../../constants/statusLabels';
import { isAwaitingPayment } from '../../../utils/bookingPayment';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';

type FilterKey = 'all' | 'active' | 'completed' | 'cancelled';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PER_PAGE = 20;

// Terminal status buckets — everything else (pending → arrived_at_dropoff)
// is "active". Used to filter the single fetched list CLIENT-SIDE so tab
// switches are instant with no extra API call.
const COMPLETED_STATUSES = new Set(['completed', 'delivered']);
const CANCELLED_STATUSES = new Set(['cancelled', 'no_runner']);
const statusBucket = (status: string): Exclude<FilterKey, 'all'> =>
  COMPLETED_STATUSES.has(status)
    ? 'completed'
    : CANCELLED_STATUSES.has(status)
      ? 'cancelled'
      : 'active';

export default function ActivityScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const chatUnread = useChatStore((s) => s.unreadCount);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  // Stable handler so RecentErrandItem's React.memo actually skips rows — an
  // inline `() => setSelectedBooking(item)` re-rendered every visible row on
  // any state change (refreshing, loadingMore, filter…).
  const handleSelectBooking = useCallback((b: Booking) => setSelectedBooking(b), []);
  // Lightweight client-side search over the loaded bookings — matches
  // errand type name or booking number. No server roundtrip.
  const [search, setSearch] = useState('');
  const hideOnScroll = useHideTabBarOnScroll();

  // CLIENT-SIDE filtering: fetch ONE unfiltered list and filter it in
  // memory per tab. Switching tabs is then instant (a pure memo recompute,
  // no network) instead of firing a fresh status-scoped request each time.
  // The key stays 'all' so it still hits the slice `preloadAfterAuth` seeds.
  // staleTime is generous (2 min); mutations (create/cancel/review) call
  // invalidateQuery(['bookings']) which forces an immediate refresh.
  const page1Q = useQuery<Booking[]>(
    ['bookings', 'activity', 'all', userId],
    async () => {
      const res = await bookingService.getBookings({
        page: 1,
        per_page: PER_PAGE,
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
  // The last "load more" failure, kept until a retry or a refresh. While it's
  // set nothing pages on its own: the footer (or the empty state) offers
  // "Try again" instead. Without this latch the auto-pager below refired the
  // moment loadingMore dropped, so offline it looped, stacked one error toast
  // per attempt and left a filtered tab on a skeleton for good.
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const loadMoreFailed = loadMoreError != null;
  // Bumped by pull-to-refresh, so a page that was still loading from before
  // the list started over is dropped when it lands instead of appended.
  const pagingGen = useRef(0);

  // Pagination is over the single unfiltered list now, so it does NOT reset
  // when the tab changes (switching tabs just re-filters what's loaded).
  useEffect(() => {
    if (page1Q.data) setHasMore((page1Q.data.length ?? 0) >= PER_PAGE);
  }, [page1Q.data]);

  // The full loaded list (page 1 + any paged-in extras), unfiltered and
  // DEDUPED by id with page-1 (freshly-revalidated) entries winning. Without
  // the dedup, a mutation that re-sorts a paged-in booking onto page 1 renders
  // it twice (duplicate React key + conflicting status). (The remaining
  // stale/vanish case for page 2+ needs extraPages to reset on mutation
  // invalidation — deferred: needs a useQuery invalidation hook + RN testing.)
  const allBookings = useMemo(() => {
    const seen = new Set<string>();
    const merged: typeof extraPages = [];
    for (const b of [...(page1Q.data ?? []), ...extraPages]) {
      if (b?.id != null) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
      }
      merged.push(b);
    }
    return merged;
  }, [page1Q.data, extraPages]);
  const loading = page1Q.loading && !page1Q.data;

  // Client-side status filter — instant tab switching, memoised per
  // (list, tab) so re-selecting a tab is free.
  const statusFiltered = useMemo(() => {
    if (filter === 'all') return allBookings;
    return allBookings.filter((b) => statusBucket(b.status) === filter);
  }, [allBookings, filter]);

  // Apply the client-side search on top of the status-filtered rows.
  const trimmedSearch = search.trim().toLowerCase();
  const visibleBookings = useMemo(() => {
    if (!trimmedSearch) return statusFiltered;
    return statusFiltered.filter((b) => {
      const typeName = b.errand_type?.name?.toLowerCase() ?? '';
      const number = b.booking_number?.toLowerCase() ?? '';
      return (
        typeName.includes(trimmedSearch) || number.includes(trimmedSearch)
      );
    });
  }, [statusFiltered, trimmedSearch]);

  // Bucket bookings by date so the list reads as a journal rather than
  // a flat infinite scroll. Active filter buckets by status instead
  // (Today/Yesterday is meaningless when everything is in-progress).
  const sections = useMemo<{ title: string; data: Booking[] }[]>(() => {
    const bookings = visibleBookings;
    if (!bookings.length) return [];
    if (filter === 'active') {
      const onTheWay: Booking[] = [];
      const inProgress: Booking[] = [];
      const searching: Booking[] = [];
      // A booking scheduled for next week is `pending` too, so bucketing on
      // status alone filed it under the live searches — the same "stuck
      // search" misread the Home card was fixed for, still landing one tab
      // over.
      const scheduled: Booking[] = [];
      // An unpaid GCash/Maya errand is `pending` too, but no runner is looked
      // for until it's paid — filing it under "Finding a runner" promised a
      // search that wasn't running.
      const awaitingPayment: Booking[] = [];
      for (const b of bookings) {
        if (b.status === 'pending') {
          if (isAwaitingPayment(b)) awaitingPayment.push(b);
          else if (scheduledWindowLabel(b)) scheduled.push(b);
          else searching.push(b);
        } else if (b.status === 'matched' || b.status === 'accepted') {
          onTheWay.push(b);
        } else {
          inProgress.push(b);
        }
      }
      return [
        // First: it's the one that needs the customer to act.
        { title: AWAITING_PAYMENT_LABEL, data: awaitingPayment },
        { title: 'In progress', data: inProgress },
        { title: 'On the way', data: onTheWay },
        { title: SCHEDULED_LABEL, data: scheduled },
        // Every header uses the same words as the chip on the rows inside it
        // (bookingStatusLabel) — the header used to say "Looking for runner"
        // directly above rows that said "Finding a Runner".
        { title: STATUS_LABELS.pending, data: searching },
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
  }, [visibleBookings, filter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    pagingGen.current += 1;
    setExtraPages([]);
    setPage(1);
    setHasMore(true);
    setLoadMoreError(null);
    await page1Q.refresh();
    setRefreshing(false);
  }, [page1Q]);

  const fetchNextPage = useCallback(async () => {
    setLoadingMore(true);
    setLoadMoreError(null);
    const nextPage = page + 1;
    const gen = pagingGen.current;
    try {
      // Always page the unfiltered list; the tabs filter it client-side.
      const res = await bookingService.getBookings({
        page: nextPage,
        per_page: PER_PAGE,
      });
      if (pagingGen.current !== gen) return;
      const data: Booking[] = res.data.data ?? [];
      setExtraPages((prev) => [...prev, ...data]);
      setPage(nextPage);
      setHasMore(data.length >= PER_PAGE);
    } catch (err) {
      // An inline "Try again" (footer or empty state), not a toast.
      if (pagingGen.current === gen) setLoadMoreError(err ?? new Error('load more failed'));
    } finally {
      setLoadingMore(false);
    }
  }, [page]);

  const onEndReached = useCallback(() => {
    // Never page past a first page that hasn't loaded, and after a failure
    // wait for an explicit retry tap — otherwise the scroll position (or the
    // auto-pager below) keeps re-triggering the failing request.
    if (!hasMore || loadingMore || loadMoreFailed || !page1Q.data) return;
    void fetchNextPage();
  }, [hasMore, loadingMore, loadMoreFailed, page1Q.data, fetchNextPage]);

  // The list is paginated over the UNFILTERED history and filtered client-side,
  // so a tab whose matches all live beyond page 1 would render an empty list —
  // and an empty list can't scroll, so onEndReached never fires and those
  // errands stay unreachable behind a false "none" state. Proactively page while
  // the active filter has zero matches but more history exists. It stops on the
  // first failure (and never starts while page 1 itself failed) — the empty
  // state then offers the retry.
  useEffect(() => {
    if (
      !trimmedSearch &&
      !loading &&
      !!page1Q.data &&
      hasMore &&
      !loadingMore &&
      !loadMoreFailed &&
      statusFiltered.length === 0
    ) {
      onEndReached();
    }
  }, [
    trimmedSearch,
    loading,
    page1Q.data,
    hasMore,
    loadingMore,
    loadMoreFailed,
    statusFiltered.length,
    onEndReached,
  ]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Activity"
        trailing={{
          icon: MessageCircle,
          onPress: () => router.push('/(customer)/chat' as any),
          badge: chatUnread,
          accessibilityLabel:
            chatUnread > 0 ? `${chatUnread} unread messages` : 'Messages',
        }}
      />

      <View className="mx-5 mt-1 items-end">
        <SyncIndicator
          syncing={page1Q.isStale}
          updatedAt={page1Q.updatedAt}
          error={!!page1Q.error}
          // Pattern 4: offline, the cached list stays and this says so.
          offline={!!page1Q.servedFromCacheOffline}
          onRetry={page1Q.refresh}
          align="flex-end"
        />
      </View>

      {/* Search — underline field filtering the loaded bookings by
          errand type name or booking number, entirely client-side. */}
      <View
        className="flex-row items-center mx-5 mt-1"
        style={{
          borderBottomWidth: 1,
          borderBottomColor: LightColors.divider,
        }}
      >
        <Search size={16} color={LightColors.textMuted} strokeWidth={2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by errand type or booking no."
          placeholderTextColor={LightColors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search your errands"
          className="flex-1 ml-2"
          style={{
            fontFamily: 'Quicksand_500Medium',
            fontSize: 15,
            color: LightColors.textPrimary,
            paddingVertical: 13, // ≈44pt row — touch-target floor
          }}
        />
        {search.length > 0 && (
          <Pressable
            onPress={() => setSearch('')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <X size={15} color={LightColors.textMuted} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>

      {/* Segmented filter pills — selected pill is a solid brand-blue
          capsule with white text; unselected pills sit on the muted
          surface tint so the row reads as one segmented control. */}
      <View className="flex-row px-5 mt-3 mb-3" style={{ gap: 8 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setFilter(f.key);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              className={`px-4 py-2 rounded-full ${
                active ? 'bg-primary' : 'bg-surfaceMuted'
              }`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                className={`text-[13px] ${
                  active
                    ? 'font-montserrat-bold text-white'
                    : 'font-montserrat-semi text-textSecondary'
                }`}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Booking List — while an uncached filter loads, only this list
          region swaps to a skeleton; the header, search field and pill
          row stay mounted so the control the user just tapped never
          vanishes. */}
      {loading && allBookings.length === 0 ? (
        <View className="flex-1 px-5 pt-3">
          {/* Pattern 5: still loading after ~4s says why, with a retry —
              above the cards, where the FAB can't cover it. */}
          <SlowNetworkNotice
            loading
            onRetry={() => void page1Q.refresh()}
            style={{ marginBottom: 12 }}
          />
          <ActivityListSkeleton />
        </View>
      ) : (
      <SectionList
        {...hideOnScroll}
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className="px-5">
            <RecentErrandItem
              booking={item}
              onPress={handleSelectBooking}
            />
          </View>
        )}
        // Date headers only — the per-day count beside each was a badge
        // nobody needed (rule 1); the rows themselves are the count.
        renderSectionHeader={({ section: { title } }) => (
          <View className="px-5 pt-3 pb-2 bg-background">
            <Eyebrow>{title}</Eyebrow>
          </View>
        )}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                Loading…
              </Text>
            </View>
          ) : loadMoreFailed && sections.length > 0 ? (
            // Same inline retry as the runner's history and the wallet. With
            // nothing on screen the empty state below carries it instead.
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                void fetchNextPage();
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading more errands"
              className="mx-5 my-2 py-3 rounded-2xl border border-divider bg-surface flex-row items-center justify-center"
              style={{ minHeight: 44 }}
            >
              <RefreshCw size={14} color={LightColors.primary} strokeWidth={2} />
              <Text className="text-[12px] font-montserrat-bold text-primary ml-2">
                Couldn’t load more · Try again
              </Text>
            </Pressable>
          ) : !hasMore && visibleBookings.length > 0 ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                That's everything
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          page1Q.error && !page1Q.data ? (
            // The first page failed with nothing cached — surface the
            // failure instead of the misleading "No errands yet".
            <ErrorState
              title="Couldn't load your errands"
              error={page1Q.error}
              onRetry={() => {
                page1Q.refresh();
              }}
            />
          ) : trimmedSearch && statusFiltered.length > 0 ? (
            // Bookings exist, the search just matched none of them —
            // distinct from the genuine no-bookings empty state.
            <StatePanel
              icon={SearchX}
              title={`No errands match “${search.trim()}”`}
              description="Try an errand type, like Delivery, or a booking number, like EG-20261107-000100."
              actionLabel="Clear search"
              onAction={() => setSearch('')}
            />
          ) : loadMoreFailed ? (
            // This tab's errands may be further back in the history, and
            // fetching the next page failed — say so instead of a skeleton
            // that never resolves.
            <ErrorState
              title="Couldn’t load more of your errands"
              error={loadMoreError}
              onRetry={() => {
                void fetchNextPage();
              }}
              retryLabel="Try again"
            />
          ) : !loading && !hasMore ? (
            // Genuine empty — only once ALL history is loaded (!hasMore).
            // Copy follows the active filter. A "Book an Errand" CTA under
            // Cancelled would read as a non-sequitur, so that tab describes
            // what lands here instead.
            filter === 'cancelled' ? (
              <StatePanel
                icon={ClipboardList}
                title="No cancelled errands"
                description="Errands you or ErrandGuy cancel show up here, with what they cost."
                actionLabel="See all errands"
                onAction={() => setFilter('all')}
              />
            ) : filter === 'completed' ? (
              <StatePanel
                icon={ClipboardList}
                title="No completed errands yet"
                description="Finished errands land here with their receipt, photos and rating."
                actionLabel="Book an errand"
                onAction={() => router.push('/(customer)/book/type' as any)}
              />
            ) : (
              <StatePanel
                icon={ClipboardList}
                title={filter === 'active' ? 'No errands running' : 'No errands yet'}
                description={
                  filter === 'active'
                    ? 'Errands that are underway show up here so you can track them.'
                    : 'Every errand you book shows up here, live while it runs and as a receipt after.'
                }
                actionLabel="Book an errand"
                onAction={() => router.push('/(customer)/book/type' as any)}
              />
            )
          ) : (
            // Still loading page 1, or paging through history to surface this
            // filter's matches — show the skeleton, never the genuine-empty
            // state (which would falsely claim none exist while pages remain).
            <ActivityListSkeleton />
          )
        }
        contentContainerStyle={{
          paddingBottom: TAB_CONTENT_BOTTOM_INSET,
          // Let empty/error states center vertically (flex-1 inside a
          // scroll container collapses without flexGrow) — same pattern
          // as trusted-contacts and support.
          flexGrow: sections.length === 0 ? 1 : undefined,
        }}
      />
      )}

      {/* Booking Detail Sheet */}
      <BookingDetailSheet
        booking={selectedBooking}
        isVisible={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
      />
    </View>
  );
}
