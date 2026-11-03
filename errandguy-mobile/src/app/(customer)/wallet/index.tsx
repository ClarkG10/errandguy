import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Wallet, Download, ChevronRight, Clock, Gift } from 'lucide-react-native';
import { toast } from '../../../stores/toastStore';
import { useWalletStore } from '../../../stores/walletStore';
import { useAuthStore } from '../../../stores/authStore';
import { usePaymentStore, isAttemptActive } from '../../../stores/paymentStore';
import { paymentService } from '../../../services/payment.service';
import { useQuery } from '../../../hooks/useQuery';
import { useWalletSummary } from '../../../hooks/useWalletSummary';
import { CacheTTL } from '../../../services/cache.service';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Illustration } from '../../../components/ui/Illustration';
import { ErrorState } from '../../../components/ui/ErrorState';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { SyncIndicator } from '../../../components/ui/SyncIndicator';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Spinner } from '../../../components/ui/Spinner';
import { Eyebrow } from '../../../components/ui/Typography';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatRelativeTime } from '../../../utils/formatDate';
import { cashDebtMessage } from '../../../utils/cashDebt';
import { withdrawMinimum } from '../../../utils/withdrawal';
import { LightColors, Elevation } from '../../../constants/colors';
import { ledgerIcon, isLedgerCredit, signedLedgerAmount } from '../../../utils/walletLedger';
import type { WalletTransaction, WalletTransactionType } from '../../../types';

// Transaction type filter — maps 1:1 onto the server's `type` query param
// (WalletController::transactions), so filtering is done server-side
// instead of hiding rows client-side. `null` = no filter.
const TX_FILTERS: { key: WalletTransactionType | null; label: string }[] = [
  { key: null, label: 'All' },
  // Only errands paid FROM the wallet are wallet rows; a GCash, Maya or cash
  // errand never touches it — so "Payments" promised more than it shows.
  { key: 'payment', label: 'Paid from wallet' },
  { key: 'refund', label: 'Refunds' },
  { key: 'payout', label: 'Withdrawals' },
];

/** Placeholder rows painted while the first transactions fetch runs so
 *  the list doesn't flash "No transactions yet" before data arrives. */
function TransactionsSkeleton() {
  return (
    <View>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} className="flex-row items-center px-5 py-3.5 border-b border-divider">
          <Skeleton width={36} height={36} borderRadius={18} />
          <View className="flex-1 ml-3">
            <Skeleton width="55%" height={13} borderRadius={4} />
            <Skeleton width={70} height={10} borderRadius={4} style={{ marginTop: 6 }} />
          </View>
          <Skeleton width={64} height={14} borderRadius={4} />
        </View>
      ))}
    </View>
  );
}

/** Rows per page of the on-screen history (the server's default page). */
const TX_PAGE_SIZE = 20;
const NO_TX: WalletTransaction[] = [];

// RFC-4180-ish escaping: quote fields containing comma / quote / newline.
const csvCell = (value: string | number | null | undefined): string => {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Build a spreadsheet-friendly CSV from the loaded transactions.
 *  Columns: Date, Description, Type, Status, Amount (signed), Balance. */
/** Rows per request when walking the full ledger for an export. */
const EXPORT_PAGE_SIZE = 100;
/**
 * Hard ceiling on exported rows.
 *
 * Generous enough that no real customer hits it, low enough that a corrupted
 * paginator can't loop forever. Hitting it is REPORTED, never silent — the
 * whole point of this change is that an export must not misrepresent itself.
 */
const EXPORT_MAX_ROWS = 5000;

/**
 * Every wallet transaction, walked page by page.
 *
 * Stops on a short page (the last one), on a page that returns nothing, or at
 * the row ceiling. `truncated` tells the caller the file is not the complete
 * history so it can say so out loud.
 */
async function fetchAllTransactions(
  type: string | null,
): Promise<{ items: WalletTransaction[]; truncated: boolean }> {
  const items: WalletTransaction[] = [];

  for (let page = 1; ; page++) {
    const r = await paymentService.getWalletTransactions({
      page,
      per_page: EXPORT_PAGE_SIZE,
      ...(type ? { type } : {}),
    });
    const batch = (r.data?.data ?? []) as WalletTransaction[];
    items.push(...batch);

    // Short page = the end. An empty page also ends it, which guards against a
    // server that keeps answering 200 past the last page.
    if (batch.length < EXPORT_PAGE_SIZE) {
      return { items, truncated: false };
    }
    if (items.length >= EXPORT_MAX_ROWS) {
      return { items: items.slice(0, EXPORT_MAX_ROWS), truncated: true };
    }
  }
}

function buildTransactionsCsv(rows: WalletTransaction[]): string {
  const header = ['Date', 'Description', 'Type', 'Status', 'Amount', 'Balance'];
  const lines = rows.map((t) => {
    // Only money that actually moved counts, so the signed column sums to the
    // real change in balance. A debit always moved: a withdrawal leaves the
    // balance the moment it is requested, and one that fails is put back by
    // its own refund row. A credit only lands once completed (a pending or
    // failed top-up from before they were retired never did).
    const moved = !isLedgerCredit(t) || (t.status !== 'pending' && t.status !== 'failed');
    const signed = moved ? signedLedgerAmount(t) : 0;
    return [
      csvCell(t.created_at),
      csvCell(t.display_description ?? t.description ?? t.type.replace('_', ' ')),
      csvCell(t.type),
      csvCell(t.status ?? 'completed'),
      csvCell(signed.toFixed(2)),
      csvCell(Number(t.balance_after).toFixed(2)),
    ].join(',');
  });
  return [header.join(','), ...lines].join('\n');
}

export default function WalletScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { balance, transactions, setBalance, setTransactions } =
    useWalletStore();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  // The persisted in-flight money attempt (a booking charge or a tip), so a
  // payment that outlived its screen has somewhere to be seen.
  const pendingAttempt = usePaymentStore((s) => s.attempt);
  const [refreshing, setRefreshing] = useState(false);
  // Server-side type filter — part of the query key so each filter keeps
  // its own cache entry and swapping back to a previous chip is instant.
  const [txFilter, setTxFilter] = useState<WalletTransactionType | null>(null);

  const balanceQ = useQuery<number>(
    ['wallet', 'balance', userId],
    async () => {
      const r = await paymentService.getWalletBalance();
      return r.data.data?.balance ?? 0;
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );
  // Withdrawable amount and bonus credit. The hero paints from the bare
  // balance above (warm from the boot snapshot); this fills in the rest — the
  // two coalesce into one request.
  const summaryQ = useWalletSummary();
  const withdrawable = summaryQ.data?.withdrawable ?? null;
  const bonusCredit = summaryQ.data?.bonus_balance ?? 0;
  // The server's floor — the same figure the withdraw screen checks.
  const withdrawMin = withdrawMinimum(summaryQ.data);

  // Page 1 is cached via useQuery (cache-first); older pages append on scroll —
  // the history used to stop at the newest 20 rows, with no way to see more.
  // Same idiom as the runner's wallet activity screen.
  const txQ = useQuery<WalletTransaction[]>(
    ['wallet', 'transactions', userId, txFilter ?? 'all'],
    async () => {
      const r = await paymentService.getWalletTransactions({
        page: 1,
        per_page: TX_PAGE_SIZE,
        ...(txFilter ? { type: txFilter } : {}),
      });
      return (r.data.data ?? []) as WalletTransaction[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );
  const [extraPages, setExtraPages] = useState<WalletTransaction[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  // A new filter (or a pull-to-refresh) starts over at page 1, and a page
  // still loading from before is ignored when it lands — see fetchNextTxPage.
  const txFilterRef = useRef(txFilter);
  txFilterRef.current = txFilter;
  const txPagingGen = useRef(0);
  useEffect(() => {
    txPagingGen.current += 1;
    setExtraPages([]);
    setTxPage(1);
    setHasMore(true);
    setLoadMoreFailed(false);
  }, [txFilter]);
  useEffect(() => {
    if (txQ.data && txPage === 1) setHasMore(txQ.data.length >= TX_PAGE_SIZE);
  }, [txQ.data, txPage]);

  // Mirror into the store so other components reading from the store stay
  // in sync (e.g., header balance pill). Only the UNFILTERED list mirrors —
  // a filtered page must not clobber what other screens read as "all".
  useEffect(() => {
    // Only mirror a real number into the store — never a stale object shape
    // from a poisoned cache entry (see the balance hero's normalize note),
    // which would leak "[object Object]" to any screen reading store.balance.
    if (typeof balanceQ.data === 'number' && Number.isFinite(balanceQ.data)) {
      setBalance(balanceQ.data);
    }
  }, [balanceQ.data, setBalance]);
  useEffect(() => {
    if (txQ.data && txFilter == null) setTransactions(txQ.data);
  }, [txQ.data, txFilter, setTransactions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    txPagingGen.current += 1;
    setExtraPages([]);
    setTxPage(1);
    setHasMore(true);
    setLoadMoreFailed(false);
    await Promise.all([balanceQ.refresh(), summaryQ.refresh(), txQ.refresh()]);
    setRefreshing(false);
  }, [balanceQ, summaryQ, txQ]);

  const fetchNextTxPage = useCallback(async () => {
    setLoadingMore(true);
    setLoadMoreFailed(false);
    const nextPage = txPage + 1;
    const forFilter = txFilter;
    const gen = txPagingGen.current;
    const stale = () => txFilterRef.current !== forFilter || txPagingGen.current !== gen;
    try {
      const r = await paymentService.getWalletTransactions({
        page: nextPage,
        per_page: TX_PAGE_SIZE,
        ...(forFilter ? { type: forFilter } : {}),
      });
      if (stale()) return;
      const data = (r.data?.data ?? []) as WalletTransaction[];
      setExtraPages((prev) => [...prev, ...data]);
      setTxPage(nextPage);
      setHasMore(data.length >= TX_PAGE_SIZE);
    } catch {
      // Inline retry in the footer — a list that silently stops is confusing.
      if (!stale()) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [txPage, txFilter]);

  const openWithdraw = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (withdrawable != null && withdrawable <= 0) {
      toast.info(
        bonusCredit > 0
          ? 'Bonus credit can’t be withdrawn — spend it on your next errands.'
          : 'There’s nothing to withdraw yet. Refunds and other credits land here.',
      );
      return;
    }
    router.push('/(customer)/wallet/withdraw');
  }, [withdrawable, bonusCredit, router]);

  const [exporting, setExporting] = useState(false);

  // List source: the query result for the active filter; the store copy
  // backs the unfiltered view so cached data paints instantly. Older pages
  // follow, de-duplicated across every page — a row that arrives between two
  // page loads shifts the server's pages by one.
  const page1 = txFilter ? txQ.data ?? NO_TX : txQ.data ?? transactions;
  const txList = useMemo(() => {
    if (!extraPages.length) return page1;
    const seen = new Set(page1.map((t) => t.id));
    const older = extraPages.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    return [...page1, ...older];
  }, [page1, extraPages]);
  const txInitialLoading = txQ.loading && !txQ.data;
  const txFailed = !!txQ.error && !txQ.data;

  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore || loadMoreFailed || !txQ.data) return;
    void fetchNextTxPage();
  }, [hasMore, loadingMore, loadMoreFailed, txQ.data, fetchNextTxPage]);

  // Group wallet transactions into date buckets so customers can scan
  // for a specific transaction without scrolling through a flat list.
  const txSections = useMemo<{ title: string; data: WalletTransaction[] }[]>(() => {
    if (!txList.length) return [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const buckets: Record<string, WalletTransaction[]> = {
      Today: [],
      Yesterday: [],
      'This Month': [],
      Earlier: [],
    };
    for (const t of txList) {
      const ts = new Date(t.created_at).getTime();
      if (ts >= startOfToday) buckets.Today.push(t);
      else if (ts >= startOfYesterday) buckets.Yesterday.push(t);
      else if (ts >= startOfMonth) buckets['This Month'].push(t);
      else buckets.Earlier.push(t);
    }
    return (['Today', 'Yesterday', 'This Month', 'Earlier'] as const)
      .filter((k) => buckets[k].length > 0)
      .map((title) => ({ title, data: buckets[title] }));
  }, [txList]);

  // Export the loaded transactions as a CSV. Mirrors the ImageLightbox
  // download pattern: write into the app sandbox via expo-file-system,
  // then hand the file to the native share sheet (expo-sharing — it attaches
  // the file on both platforms — or RN Share where sharing isn't available).
  const handleExport = useCallback(async () => {
    if (exporting) return;
    if (!txList.length) {
      toast.info('No transactions to export yet');
      return;
    }
    setExporting(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      // Export the WHOLE history, not the page on screen.
      //
      // The list fetched one server page (20 rows), so this used to hand over
      // a CSV of the 20 most recent transactions named
      // "errandguy-transactions-<date>.csv" — a file that looks like a complete
      // record and silently isn't. A short on-screen list is visibly short; an
      // authoritative-looking export that omits ten months of spending is the
      // kind of thing someone reconciles their money against.
      //
      // Paged rather than one huge request so a long history can't time out,
      // and bounded so a pathological account can't spin here forever. If the
      // bound is hit we say so instead of shipping a silently truncated file.
      const rows = await fetchAllTransactions(txFilter);
      const csv = buildTransactionsCsv(rows.items);
      if (rows.truncated) {
        toast.info(
          `Exported your ${rows.items.length.toLocaleString()} most recent transactions.`,
        );
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const fileUri = `${FileSystem.cacheDirectory}errandguy-transactions-${stamp}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export transactions',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        // Fallback: RN's share sheet. iOS attaches the file via `url`;
        // Android has no file-attach path here, so the CSV is written to
        // the sandbox and its location shared as a message.
        await Share.share({
          url: fileUri,
          message: `ErrandGuy transactions (${stamp})`,
          title: 'Export transactions',
        });
      }
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    } catch {
      toast.error("Couldn't export transactions. Please try again.");
    } finally {
      setExporting(false);
    }
    // txFilter is read inside (the export honours the active filter), so it
    // must be a dependency — a stale closure would export the wrong ledger
    // slice after the customer switches filter.
  }, [exporting, txList, txFilter]);

  const renderTransaction = useCallback(({ item }: { item: WalletTransaction }) => {
    const config = ledgerIcon(item.type);
    const Icon = config.icon;
    const isCredit = isLedgerCredit(item);
    // A row only reads as settled money when its lifecycle says so: a
    // withdrawal is 'pending' until staff send it, and 'failed' if it bounced
    // (the money then comes back on its own refund row).
    const isPending = item.status === 'pending';
    const isFailed = item.status === 'failed';
    const settled = !isPending && !isFailed;
    const isWithdrawal = item.type === 'payout';

    const amountClass = !settled
      ? 'text-textMuted'
      : isCredit
        ? 'text-success'
        : 'text-textPrimary';
    // No +/− on an unsettled row — a sign implies the money moved for good.
    const sign = !settled ? '' : isCredit ? '+' : '−';

    return (
      <View className="flex-row items-center px-5 py-3.5 border-b border-divider">
        {/* Soft muted chip keeps the type icon glanceable while the amount on
            the right carries the visual weight. Unsettled rows use a neutral
            glyph so a pending row doesn't flash a status colour. */}
        <View className="w-9 h-9 rounded-full bg-surfaceMuted items-center justify-center">
          <Icon
            size={17}
            color={settled ? config.color : LightColors.textMuted}
            strokeWidth={1.8}
          />
        </View>
        <View className="flex-1 ml-3">
          {/* Two lines, so the errand number at the end is never cut off. */}
          <Text
            className="text-[14px] font-montserrat-bold text-textPrimary"
            numberOfLines={2}
          >
            {item.display_description ?? item.description ?? item.type.replace('_', ' ')}
          </Text>
          <View className="flex-row items-center mt-0.5">
            <Text className="text-[11px] font-montserrat text-textSecondary">
              {formatRelativeTime(item.created_at)}
            </Text>
            {isPending ? (
              <Text
                className="text-[11px] font-montserrat-semi ml-1.5"
                // *Dark rung: base `warning` is ~2.1:1 on this canvas at 11px,
                // under the 4.5:1 AA floor for small status text (colors.ts).
                style={{ color: LightColors.warningDark }}
              >
                · Pending
              </Text>
            ) : isFailed ? (
              <Text
                className="text-[11px] font-montserrat-semi ml-1.5"
                // *Dark rung: base `danger` is ~3.8:1 on this canvas at 11px,
                // under the 4.5:1 AA floor for small status text (colors.ts).
                style={{ color: LightColors.dangerDark }}
              >
                · Failed
              </Text>
            ) : null}
          </View>
          {/* A withdrawal is the one row with a wait attached, so it says what
              happens next rather than leaving "Pending" to be decoded. */}
          {isWithdrawal && isPending ? (
            <Text className="text-[10px] font-montserrat text-textTertiary mt-1">
              On its way — usually arrives within 1–3 business days.
            </Text>
          ) : isWithdrawal && isFailed ? (
            <Text className="text-[10px] font-montserrat text-textTertiary mt-1" numberOfLines={2}>
              Didn’t go through — the money is back in your balance.
              {item.failure_reason ? ` ${item.failure_reason}` : ''}
            </Text>
          ) : null}
        </View>
        <View className="items-end">
          <Text className={`text-[15px] font-inter-semi tabular-nums ${amountClass}`}>
            {sign}
            {formatCurrency(Math.abs(item.amount))}
          </Text>
          {/* The running balance is real once the money left or landed — a
              pending withdrawal is already debited, so it shows there too. */}
          {settled || (isPending && isWithdrawal) ? (
            <Text className="text-[10px] font-inter tabular-nums text-textMuted mt-0.5">
              {formatCurrency(item.balance_after)}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }, []);

  // The hub scrolls as ONE unit: the balance hero, Transactions eyebrow
  // and filter chips ride in the list header
  // so they scroll away and give the ledger full height on small phones
  // (SE / 360dp Android) instead of pinning it to ~1 visible row.
  const listHeader = (
    <View>
      {/* Balance Card — the wallet's hero. Brand three-stop gradient
          (ride-hailing "cash card" pattern), rounded-2xl, white
          tabular-nums amount carrying the emphasis. This is the one
          place outside CTAs where a full blue fill is intentional:
          the balance IS the product here. */}
      <LinearGradient
        colors={[
          LightColors.gradientStart,
          LightColors.gradientMid,
          LightColors.gradientEnd,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        // Plain style (not className) — LinearGradient isn't NativeWind-
        // registered, so tailwind classes would be silently dropped.
        style={{
          marginHorizontal: 20,
          marginTop: 4,
          marginBottom: 16,
          padding: 24,
          overflow: 'hidden',
          borderRadius: 24,
          ...Elevation.primary,
        }}
      >
        {/* Decorative 3D wallet — first child so it renders BEHIND the
            balance text/buttons (text stays readable) and the card's
            overflow:hidden clips its right edge into the corner. Subtle
            ambient hero object beside the balance, not a focal element. */}
        <Illustration
          name="3d-wallet"
          size={72}
          style={{ position: 'absolute', top: 34, right: 10, opacity: 0.9 }}
        />

        <View className="flex-row items-center justify-between mb-1">
          <View className="flex-row items-center">
            <Wallet size={14} color="rgba(255,255,255,0.7)" strokeWidth={2} />
            <Text className="ml-2 text-xs font-montserrat-semi text-white/60 uppercase tracking-wider">
              Available Balance
            </Text>
          </View>
          <View className="flex-row items-center bg-white/10 px-2 py-0.5 rounded-md">
            <Text className="text-[10px] font-montserrat-semi text-white">
              PHP
            </Text>
          </View>
        </View>

        {(() => {
          // Normalize to a finite number. The store/cache can briefly hold a
          // stale non-numeric shape (an older build seeded the whole balance
          // OBJECT under this cache key), so we reject anything that isn't a
          // real number and treat it as "not loaded yet" — a skeleton, never
          // "₱[object Object]".
          const numericBalance =
            typeof balanceQ.data === 'number' && Number.isFinite(balanceQ.data)
              ? balanceQ.data
              : typeof balance === 'number' && Number.isFinite(balance)
                ? balance
                : null;

          if (numericBalance == null && balanceQ.error) {
            // Balance fetch failed with nothing usable cached — surface it
            // instead of painting a misleading ₱0.00. White inset so the
            // danger-tinted compact row stays legible on the gradient.
            return (
              <View className="mt-3 bg-white rounded-2xl px-3 py-2">
                <ErrorState
                  compact
                  title="Couldn't load your balance"
                  error={balanceQ.error}
                  onRetry={() => balanceQ.refresh()}
                />
              </View>
            );
          }
          if (numericBalance == null) {
            return <View className="mt-2 h-10 w-44 rounded-lg bg-white/15" />;
          }
          // An account that is also a runner can owe money from cash errands;
          // the balance is then negative and says so in the server's words.
          if (numericBalance < 0) {
            return (
              <>
                <Text
                  className="text-4xl font-inter-semi tabular-nums text-white mt-1"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  −{formatCurrency(Math.abs(numericBalance))}
                </Text>
                <Text className="text-[11px] font-montserrat text-white/85 mt-1.5">
                  {cashDebtMessage(Math.abs(numericBalance))}
                </Text>
              </>
            );
          }
          // Single-line guard: a seven-figure balance shrinks to fit
          // rather than wrapping and breaking the hero's proportions.
          return (
            <>
              <Text
                className="text-4xl font-inter-semi tabular-nums text-white mt-1"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {formatCurrency(numericBalance)}
              </Text>
              {/* Under the server's minimum nothing can go out yet, so say what
                  it takes rather than offering an amount that would be refused. */}
              {withdrawable != null ? (
                <Text className="text-[11px] font-montserrat text-white/85 mt-1.5">
                  {withdrawable >= withdrawMin
                    ? `${formatCurrency(withdrawable)} can be withdrawn to GCash or Maya`
                    : `You can withdraw to GCash or Maya once you have ${formatCurrency(withdrawMin)} or more`}
                </Text>
              ) : null}
              {/* Credit left from the retired referral program: it pays for
                  errands (first, before the balance) but can never be cashed
                  out, so it sits apart from the withdrawable figure. */}
              {bonusCredit > 0 ? (
                <View className="flex-row items-start mt-1.5 pr-16">
                  <Gift
                    size={12}
                    color="rgba(255,255,255,0.85)"
                    strokeWidth={2}
                    style={{ marginTop: 2 }}
                  />
                  <Text className="flex-1 ml-1.5 text-[11px] font-montserrat text-white/85">
                    +{formatCurrency(bonusCredit)} bonus credit — spend it on errands. It
                    can’t be withdrawn.
                  </Text>
                </View>
              ) : null}
            </>
          );
        })()}

        <View className="mt-5 flex-row gap-2">
          <Pressable
            onPress={openWithdraw}
            className="flex-1 bg-white py-3.5 items-center"
            style={({ pressed }) => [
              { borderRadius: 16, overflow: 'hidden' },
              pressed && { opacity: 0.85 },
            ]}
            android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
            accessibilityRole="button"
            accessibilityLabel="Withdraw to GCash or Maya"
          >
            <Text className="text-sm font-montserrat-bold text-textPrimary">
              Withdraw
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(customer)/(tabs)/activity' as any)}
            className="flex-1 py-3.5 items-center"
            style={({ pressed }) => [
              { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
              pressed && { opacity: 0.85 },
            ]}
            android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
            accessibilityRole="button"
            accessibilityLabel="Bookings"
          >
            {/* Routes to the Activity (bookings) tab — labelled honestly so
                it isn't confused with the wallet transaction history below. */}
            <Text className="text-sm font-montserrat-bold text-white">
              Bookings
            </Text>
          </Pressable>
        </View>
      </LinearGradient>

      {/* In-flight payment. The verification hook is mounted on only a handful
          of screens, so an attempt that survived a kill (routine on low-RAM
          Androids during the GCash app hop) had NO surface at all — its only
          symptom was the next booking or tip being refused. The wallet is where
          a customer looks for missing money, so it says so here and links to
          /payment-complete, which owns the full outcome UI (and whose "Got it"
          releases the one-payment-at-a-time lock). Scoped to non-terminal
          attempts; the store's 6h staleness drop keeps it from ever becoming
          permanent. Caution amber (warning), matching PaymentProgress's own
          pending state — not the brand gold accent. */}
      {isAttemptActive(pendingAttempt) && pendingAttempt ? (
        <View className="px-5 mb-3">
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              router.push('/payment-complete');
            }}
            className="flex-row items-center rounded-2xl bg-warningSoft px-4 py-3"
            accessibilityRole="button"
            accessibilityLabel={`Confirming your ${formatCurrency(pendingAttempt.amount)} ${
              pendingAttempt.kind === 'tip' ? 'tip' : 'payment'
            }. Tap to check its status.`}
            style={({ pressed }) => (pressed ? { opacity: 0.75 } : null)}
          >
            <Clock size={16} color={LightColors.warningDark} strokeWidth={2} />
            <View className="flex-1 ml-2.5">
              <Text
                className="text-[12px] font-montserrat-bold"
                style={{ color: LightColors.warningDark }}
              >
                Confirming your {formatCurrency(pendingAttempt.amount)}{' '}
                {pendingAttempt.kind === 'tip' ? 'tip' : 'payment'}
              </Text>
              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                No need to pay again — tap to check its status.
              </Text>
            </View>
            <ChevronRight size={16} color={LightColors.warningDark} strokeWidth={2} />
          </Pressable>
        </View>
      ) : null}

      {/* Ambient sync status — sits quietly under the balance hero,
          above the ledger. Purely informational. */}
      <View className="px-5 mb-2">
        <SyncIndicator
          syncing={balanceQ.isStale || summaryQ.isStale || txQ.isStale}
          updatedAt={balanceQ.updatedAt}
          error={!!balanceQ.error}
          onRetry={onRefresh}
          align="flex-start"
        />
      </View>

      {/* Transactions section header — typographic eyebrow above the
          list. Section bucket headers below render as smaller eyebrows
          for date-bucket separation. */}
      <View className="px-5 mt-2 mb-2">
        <Eyebrow>Transactions</Eyebrow>
      </View>

      {/* Type filter chips — server-side filter via ?type=… */}
      <View className="flex-row px-5 mb-1" style={{ gap: 8 }}>
        {TX_FILTERS.map(({ key, label }) => {
          const selected = txFilter === key;
          return (
            <Pressable
              key={label}
              onPress={() => {
                if (selected) return;
                Haptics.selectionAsync().catch(() => {});
                setTxFilter(key);
              }}
              hitSlop={{ top: 10, bottom: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Filter transactions: ${label}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => pressed && { opacity: 0.7 }}
              className={`px-3.5 py-1.5 rounded-full border ${
                selected
                  ? 'bg-primary border-primary'
                  : 'bg-surface border-divider'
              }`}
            >
              <Text
                className={`text-[11px] font-montserrat-semi ${
                  selected ? 'text-white' : 'text-textSecondary'
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Wallet"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
        trailing={{
          icon: Download,
          onPress: handleExport,
          accessibilityLabel: 'Export transactions as CSV',
        }}
      />

      <SectionList
        sections={txSections}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        ListHeaderComponent={listHeader}
        renderSectionHeader={({ section: { title } }) => (
          <View className="px-5 pt-3 pb-2 bg-background">
            <Text className="text-[11px] font-montserrat-bold text-textTertiary uppercase tracking-wider">
              {title}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? (
            <View className="py-5 items-center">
              <Spinner size="small" />
            </View>
          ) : loadMoreFailed ? (
            <View className="py-5 items-center">
              <Text className="text-[12px] font-montserrat text-textSecondary mb-2">
                Couldn’t load more transactions.
              </Text>
              <Pressable
                onPress={() => void fetchNextTxPage()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Retry loading more transactions"
              >
                <Text className="text-[12px] font-montserrat-bold text-primary">Try again</Text>
              </Pressable>
            </View>
          ) : !hasMore && txList.length > 0 ? (
            <Text
              className="text-[11px] font-montserrat text-center py-5"
              style={{ color: LightColors.textMuted }}
            >
              That’s your full wallet history.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          txInitialLoading ? (
            <TransactionsSkeleton />
          ) : txFailed ? (
            <ErrorState
              title="Couldn't load transactions"
              error={txQ.error}
              onRetry={() => txQ.refresh()}
            />
          ) : (
            <EmptyState
              illustration={<Illustration name="empty-wallet" size={168} />}
              title="No transactions yet"
              description="Your wallet transaction history will appear here"
            />
          )
        }
      />
    </View>
  );
}
