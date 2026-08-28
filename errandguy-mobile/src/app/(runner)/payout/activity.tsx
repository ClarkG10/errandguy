import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../../../components/ui/Card';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { ErrorState } from '../../../components/ui/ErrorState';
import { RunnerEmptyState } from '../../../components/ui/RunnerEmptyState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { SyncIndicator } from '../../../components/ui/SyncIndicator';
import { Spinner } from '../../../components/ui/Spinner';
import { WalletActivityRow } from '../../../components/runner/WalletActivityRow';
import { useAuthStore } from '../../../stores/authStore';
import { paymentService } from '../../../services/payment.service';
import { userService } from '../../../services/user.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { useResponsive } from '../../../constants/responsive';
import { formatCurrency } from '../../../utils/formatCurrency';
import type { WalletTransaction } from '../../../types';
import { LightColors } from '../../../constants/colors';

const PAGE_SIZE = 25;

/**
 * The runner's full wallet ledger.
 *
 * Until now the runner app listed only `type=payout` rows, so every OTHER
 * movement — the platform commission debited after a cash errand, an admin
 * adjustment, a failed-payout re-credit, a tip, an earning that settled hours
 * after completion — changed the balance with no in-app explanation. This
 * reads the same `GET /wallet/transactions` the customer wallet uses (no role
 * gate on the route) and renders every type.
 */
export default function WalletActivityScreen() {
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const setUser = useAuthStore((s) => s.setUser);
  const balance = Number(useAuthStore((s) => s.user?.wallet_balance) ?? 0);

  // Page 1 is cached via useQuery (cache-first); later pages append.
  // Mirrors the runner history screen's pagination idiom.
  const page1Q = useQuery<WalletTransaction[]>(
    ['runner', 'wallet', 'ledger', userId],
    async () => {
      const res = await paymentService.getWalletTransactions({ page: 1, per_page: PAGE_SIZE });
      return (res.data?.data ?? []) as WalletTransaction[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  const [extraPages, setExtraPages] = useState<WalletTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  useEffect(() => {
    if (page1Q.data) setHasMore((page1Q.data.length ?? 0) >= PAGE_SIZE);
  }, [page1Q.data]);

  // wallet_balance in authStore is only ever written by setUser, so the hero
  // can still read the pre-commission figure while the rows under it already
  // end at the new `balance_after`. The hero and the ledger it sits on must
  // agree — reconciling them is this screen's entire job. Same mount refresh
  // the payout screen does for the same number.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await userService.getProfile();
        if (cancelled) return;
        if (me.data?.data) setUser(me.data.data);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(
    () => [...(page1Q.data ?? []), ...extraPages],
    [page1Q.data, extraPages],
  );
  const initialLoading = page1Q.loading && !page1Q.data;
  const page1Failed = !!page1Q.error && !page1Q.data;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setExtraPages([]);
    setPage(1);
    setHasMore(true);
    setLoadMoreFailed(false);
    // The user record rides along with the rows: a pull that refreshed the
    // ledger but left the balance above it untouched is the contradiction the
    // runner pulled to resolve in the first place.
    try {
      const [me] = await Promise.all([userService.getProfile(), page1Q.refresh()]);
      if (me.data?.data) setUser(me.data.data);
    } catch {}
    setRefreshing(false);
  }, [page1Q, setUser]);

  const fetchNextPage = useCallback(async () => {
    setLoadingMore(true);
    setLoadMoreFailed(false);
    const nextPage = page + 1;
    try {
      const res = await paymentService.getWalletTransactions({
        page: nextPage,
        per_page: PAGE_SIZE,
      });
      const data = (res.data?.data ?? []) as WalletTransaction[];
      setExtraPages((prev) => [...prev, ...data]);
      setPage(nextPage);
      setHasMore(data.length >= PAGE_SIZE);
    } catch {
      // Inline retry in the footer beats a transient toast — a list that
      // silently stops mid-scroll is confusing.
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [page]);

  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore || loadMoreFailed) return;
    fetchNextPage();
  }, [hasMore, loadingMore, loadMoreFailed, fetchNextPage]);

  const renderItem = useCallback(
    ({ item, index }: { item: WalletTransaction; index: number }) => (
      <WalletActivityRow tx={item} divider={index < rows.length - 1} />
    ),
    [rows.length],
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Wallet activity" showBack fallbackHref="/(runner)/payout" />

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          paddingBottom: 24 + insets.bottom,
        }}
        ListHeaderComponent={
          // Rows are full-bleed surface bands separated by hairlines (the
          // wallet-ledger idiom), so the horizontal gutter lives on the
          // header/empty/footer blocks instead of the list container.
          <View className="px-5 pt-1 pb-3">
            <Card padding="lg" tone={balance < 0 ? 'tinted' : 'default'}>
              <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary" style={{ letterSpacing: 1.2 }}>
                {balance < 0 ? 'Platform fees owed' : 'Current balance'}
              </Text>
              <Text className="text-[26px] font-inter-semi tabular-nums text-textPrimary mt-1">
                {balance < 0 ? '−' : ''}
                {formatCurrency(Math.abs(balance))}
              </Text>
              {balance < 0 ? (
                // A cash-heavy runner goes negative BY DESIGN: the platform
                // commission on a cash errand is debited from the wallet
                // because the runner already pocketed the fare. Saying so is
                // the whole point of this screen.
                <Text className="text-[12px] font-montserrat text-textSecondary mt-1.5">
                  You collected these fares in cash, so the platform fee sits here as a balance
                  owed. It’s settled automatically from your next online earnings — there’s
                  nothing to pay separately.
                </Text>
              ) : (
                <Text className="text-[12px] font-montserrat text-textSecondary mt-1.5">
                  Every movement in and out of your ErrandGuy wallet — earnings, tips, platform
                  fees, adjustments and payouts.
                </Text>
              )}
            </Card>
            <View className="mt-3">
              <SyncIndicator
                syncing={page1Q.isStale}
                updatedAt={page1Q.updatedAt}
                error={!!page1Q.error}
                offline={!!page1Q.servedFromCacheOffline}
                onRetry={page1Q.refresh}
                align="flex-start"
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="px-5">
            {initialLoading ? (
            <Card className="p-0 overflow-hidden">
              {[1, 2, 3, 4, 5].map((i) => (
                <View
                  key={i}
                  className={`flex-row items-center px-4 py-3 ${i < 5 ? 'border-b border-divider' : ''}`}
                >
                  <Skeleton width={36} height={36} borderRadius={18} />
                  <View className="flex-1 ml-3">
                    <Skeleton width="60%" height={13} style={{ marginBottom: 6 }} />
                    <Skeleton width="30%" height={10} />
                  </View>
                  <Skeleton width={60} height={14} />
                </View>
              ))}
            </Card>
          ) : page1Failed ? (
            <ErrorState
              title="Couldn't load your wallet activity"
              description="Check your connection and try again."
              onRetry={() => page1Q.refresh()}
            />
          ) : (
            <RunnerEmptyState
              eyebrow="Wallet"
              title="No wallet activity yet"
              description="Earnings, tips, platform fees and payouts will all show up here."
            />
            )}
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="py-5 items-center">
              <Spinner size="small" />
            </View>
          ) : loadMoreFailed ? (
            <View className="py-5 items-center">
              <Text className="text-[12px] font-montserrat text-textSecondary mb-2">
                Couldn’t load more activity.
              </Text>
              <Pressable
                onPress={fetchNextPage}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Retry loading more wallet activity"
              >
                <Text className="text-[12px] font-montserrat-bold text-primary">Try again</Text>
              </Pressable>
            </View>
          ) : !hasMore && rows.length > 0 ? (
            <Text
              className="text-[11px] font-montserrat text-center py-5"
              style={{ color: LightColors.textMuted }}
            >
              That’s your full wallet history.
            </Text>
          ) : null
        }
        style={{ flex: 1 }}
      />
    </View>
  );
}
