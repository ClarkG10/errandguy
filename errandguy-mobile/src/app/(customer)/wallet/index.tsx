import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  Star,
  Wallet,
  Check,
  Plus,
  Download,
} from 'lucide-react-native';
import { toast } from '../../../stores/toastStore';
import type { LucideIcon } from 'lucide-react-native';
import { useWalletStore } from '../../../stores/walletStore';
import { useAuthStore } from '../../../stores/authStore';
import { paymentService } from '../../../services/payment.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Illustration } from '../../../components/ui/Illustration';
import { ErrorState } from '../../../components/ui/ErrorState';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { SyncIndicator } from '../../../components/ui/SyncIndicator';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Hairline, Eyebrow } from '../../../components/ui/Typography';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatRelativeTime } from '../../../utils/formatDate';
import { LightColors, Elevation } from '../../../constants/colors';
import type { WalletTransaction, WalletTransactionType } from '../../../types';

const TX_ICONS: Record<WalletTransactionType, { icon: LucideIcon; color: string }> = {
  top_up: { icon: ArrowUpCircle, color: LightColors.success },
  payment: { icon: ArrowDownCircle, color: LightColors.danger },
  refund: { icon: RotateCcw, color: LightColors.primary },
  payout: { icon: ArrowDownCircle, color: LightColors.warning },
  bonus: { icon: Star, color: LightColors.accentStrong },
};

// Transaction type filter — maps 1:1 onto the server's `type` query param
// (WalletController::transactions), so filtering is done server-side
// instead of hiding rows client-side. `null` = no filter.
const TX_FILTERS: { key: WalletTransactionType | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'top_up', label: 'Top-ups' },
  { key: 'payment', label: 'Payments' },
  { key: 'refund', label: 'Refunds' },
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

/**
 * `expo-file-system` and `expo-sharing` are native modules. If the dev
 * client hasn't been rebuilt since they were added, a static `import`
 * crashes the whole JS bundle at evaluation. We resolve them through an
 * opaque indirection (same guard as ImageLightbox) so Metro can't
 * pre-bundle them and any failure is caught → friendly toast.
 */
function tryRequire<T = any>(moduleName: string): T | null {
  try {
    const req = (globalThis as any).require ?? (() => null);
    return req(moduleName) as T;
  } catch {
    return null;
  }
}
let fileSystemCache: any | null | undefined;
function getFileSystem(): any | null {
  if (fileSystemCache !== undefined) return fileSystemCache;
  // The legacy submodule exposes the imperative writeAsStringAsync + dirs.
  fileSystemCache = tryRequire('expo-file-system/legacy');
  return fileSystemCache;
}

// A positive (credit) movement in the ledger.
const isCreditType = (t: WalletTransactionType) =>
  t === 'top_up' || t === 'refund' || t === 'bonus';

// RFC-4180-ish escaping: quote fields containing comma / quote / newline.
const csvCell = (value: string | number | null | undefined): string => {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Build a spreadsheet-friendly CSV from the loaded transactions.
 *  Columns: Date, Description, Type, Amount (signed), Balance. */
function buildTransactionsCsv(rows: WalletTransaction[]): string {
  const header = ['Date', 'Description', 'Type', 'Amount', 'Balance'];
  const lines = rows.map((t) => {
    const signed = (isCreditType(t.type) ? 1 : -1) * Math.abs(t.amount);
    return [
      csvCell(t.created_at),
      csvCell(t.display_description ?? t.description ?? t.type.replace('_', ' ')),
      csvCell(t.type),
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

  const txQ = useQuery<WalletTransaction[]>(
    ['wallet', 'transactions', userId, txFilter ?? 'all'],
    async () => {
      const r = await paymentService.getWalletTransactions(
        txFilter ? { type: txFilter } : undefined,
      );
      return (r.data.data ?? []) as WalletTransaction[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

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
    await Promise.all([balanceQ.refresh(), txQ.refresh()]);
    setRefreshing(false);
  }, [balanceQ, txQ]);

  const [exporting, setExporting] = useState(false);

  // List source: the query result for the active filter; the store copy
  // backs the unfiltered view so cached data paints instantly.
  const txList = txFilter ? txQ.data ?? [] : txQ.data ?? transactions;
  const txInitialLoading = txQ.loading && !txQ.data;
  const txFailed = !!txQ.error && !txQ.data;

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
  // then hand the file to the native share sheet (expo-sharing when it's
  // linked — it attaches the file on both platforms — otherwise RN Share).
  const handleExport = useCallback(async () => {
    if (exporting) return;
    if (!txList.length) {
      toast.info('No transactions to export yet');
      return;
    }
    const FileSystem = getFileSystem();
    if (!FileSystem) {
      toast.error('Export unavailable. Please rebuild the app to enable it.');
      return;
    }
    setExporting(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const csv = buildTransactionsCsv(txList);
      const stamp = new Date().toISOString().slice(0, 10);
      const fileUri = `${FileSystem.cacheDirectory}errandguy-transactions-${stamp}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv);

      const Sharing = tryRequire('expo-sharing');
      if (Sharing?.shareAsync && (await Sharing.isAvailableAsync())) {
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
  }, [exporting, txList]);

  const renderTransaction = useCallback(
    ({ item }: { item: WalletTransaction }) => {
      const config = TX_ICONS[item.type] ?? TX_ICONS.payment;
      const Icon = config.icon;
      const isPositive = item.type === 'top_up' || item.type === 'refund' || item.type === 'bonus';

      return (
        <View className="flex-row items-center px-5 py-3.5 border-b border-divider">
          {/* Soft muted chip keeps the type icon glanceable while the
              amount on the right carries the visual weight. */}
          <View className="w-9 h-9 rounded-full bg-surfaceMuted items-center justify-center">
            <Icon size={17} color={config.color} strokeWidth={1.8} />
          </View>
          <View className="flex-1 ml-3">
            <Text
              className="text-[14px] font-montserrat-bold text-textPrimary"
              numberOfLines={1}
            >
              {item.display_description ?? item.description ?? item.type.replace('_', ' ')}
            </Text>
            <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
              {formatRelativeTime(item.created_at)}
            </Text>
          </View>
          <View className="items-end">
            <Text
              className={`text-[15px] font-inter-semi tabular-nums ${
                isPositive ? 'text-success' : 'text-textPrimary'
              }`}
            >
              {isPositive ? '+' : '−'}
              {formatCurrency(Math.abs(item.amount))}
            </Text>
            <Text className="text-[10px] font-inter tabular-nums text-textMuted mt-0.5">
              {formatCurrency(item.balance_after)}
            </Text>
          </View>
        </View>
      );
    },
    [],
  );

  // The hub scrolls as ONE unit: the balance hero, payment-methods
  // card, Transactions eyebrow and filter chips ride in the list header
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
                  description="Check your connection and retry."
                  onRetry={() => balanceQ.refresh()}
                />
              </View>
            );
          }
          if (numericBalance == null) {
            return <View className="mt-2 h-10 w-44 rounded-lg bg-white/15" />;
          }
          // Single-line guard: a seven-figure balance shrinks to fit
          // rather than wrapping and breaking the hero's proportions.
          return (
            <Text
              className="text-4xl font-inter-semi tabular-nums text-white mt-1"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatCurrency(numericBalance)}
            </Text>
          );
        })()}

        <View className="mt-5 flex-row gap-2">
          <Pressable
            onPress={() => router.push('/(customer)/wallet/top-up')}
            className="flex-1 bg-white py-3.5 items-center"
            style={({ pressed }) => [
              { borderRadius: 16, overflow: 'hidden' },
              pressed && { opacity: 0.85 },
            ]}
            android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
            accessibilityRole="button"
            accessibilityLabel="Add money to wallet"
          >
            <Text className="text-sm font-montserrat-bold text-textPrimary">
              Add money
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

      {/* Ambient sync status — sits quietly under the balance hero,
          above the ledger. Purely informational. */}
      <View className="px-5 mb-2">
        <SyncIndicator
          syncing={balanceQ.isStale || txQ.isStale}
          updatedAt={balanceQ.updatedAt}
          error={!!balanceQ.error}
          onRetry={onRefresh}
          align="flex-start"
        />
      </View>

      {/* Payment Methods — white card of rows (icon chip • label •
          check) with an "+ Add payment method" footer row in primary
          text, matching the reference wallet layout. */}
      <View className="px-5 mb-2">
        <Eyebrow className="mb-2">Payment methods</Eyebrow>
        <Card padding="none" className="px-4">
          <View className="flex-row items-center py-3.5">
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
              <Wallet size={18} color={LightColors.primary} strokeWidth={1.9} />
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                ErrandGuy Wallet
              </Text>
              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                Pay errands with your balance
              </Text>
            </View>
            <Check size={18} color={LightColors.primary} strokeWidth={2.2} />
          </View>
          <Hairline />
          {/* Opens the linked/saved e-wallet manager — the row adds a
              payment METHOD, not money (Add money lives on the hero). */}
          <Pressable
            onPress={() => router.push('/(customer)/payment-methods')}
            className="flex-row items-center py-3.5"
            style={({ pressed }) => pressed && { opacity: 0.6 }}
            accessibilityRole="button"
            accessibilityLabel="Add payment method"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
              <Plus size={18} color={LightColors.primary} strokeWidth={2.2} />
            </View>
            <Text className="flex-1 text-[14px] font-montserrat-bold text-primary">
              Add payment method
            </Text>
          </Pressable>
        </Card>
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
        ListEmptyComponent={
          txInitialLoading ? (
            <TransactionsSkeleton />
          ) : txFailed ? (
            <ErrorState
              title="Couldn't load transactions"
              description="Check your connection and try again."
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
