import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  RefreshControl,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  Star,
  Wallet,
  Check,
  Plus,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useWalletStore } from '../../../stores/walletStore';
import { useAuthStore } from '../../../stores/authStore';
import { paymentService } from '../../../services/payment.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Hairline } from '../../../components/ui/Typography';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatRelativeTime } from '../../../utils/formatDate';
import { LightColors, Elevation } from '../../../constants/colors';
import type { WalletTransaction, WalletTransactionType } from '../../../types';
import { toast } from '../../../stores/toastStore';

const TX_ICONS: Record<WalletTransactionType, { icon: LucideIcon; color: string }> = {
  top_up: { icon: ArrowUpCircle, color: LightColors.success },
  payment: { icon: ArrowDownCircle, color: LightColors.danger },
  refund: { icon: RotateCcw, color: LightColors.primary },
  payout: { icon: ArrowDownCircle, color: LightColors.warning },
  bonus: { icon: Star, color: LightColors.warning },
};

export default function WalletScreen() {
  const router = useRouter();
  const { balance, transactions, setBalance, setTransactions } =
    useWalletStore();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const [refreshing, setRefreshing] = useState(false);

  const balanceQ = useQuery<number>(
    ['wallet', 'balance', userId],
    async () => {
      const r = await paymentService.getWalletBalance();
      return r.data.data?.balance ?? 0;
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  const txQ = useQuery<WalletTransaction[]>(
    ['wallet', 'transactions', userId],
    async () => {
      const r = await paymentService.getWalletTransactions();
      return (r.data.data ?? []) as WalletTransaction[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  // Mirror into the store so other components reading from the store stay
  // in sync (e.g., header balance pill).
  useEffect(() => {
    if (balanceQ.data != null) setBalance(balanceQ.data);
  }, [balanceQ.data, setBalance]);
  useEffect(() => {
    if (txQ.data) setTransactions(txQ.data);
  }, [txQ.data, setTransactions]);

  // Show error toast only when both queries failed and we have no cache.
  useEffect(() => {
    if (balanceQ.error && txQ.error && balanceQ.data == null && txQ.data == null) {
      toast.error('Failed to load wallet data.');
    }
  }, [balanceQ.error, txQ.error, balanceQ.data, txQ.data]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([balanceQ.refresh(), txQ.refresh()]);
    setRefreshing(false);
  }, [balanceQ, txQ]);

  // Group wallet transactions into date buckets so customers can scan
  // for a specific transaction without scrolling through a flat list.
  const txSections = useMemo<{ title: string; data: WalletTransaction[] }[]>(() => {
    if (!transactions.length) return [];
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
    for (const t of transactions) {
      const ts = new Date(t.created_at).getTime();
      if (ts >= startOfToday) buckets.Today.push(t);
      else if (ts >= startOfYesterday) buckets.Yesterday.push(t);
      else if (ts >= startOfMonth) buckets['This Month'].push(t);
      else buckets.Earlier.push(t);
    }
    return (['Today', 'Yesterday', 'This Month', 'Earlier'] as const)
      .filter((k) => buckets[k].length > 0)
      .map((title) => ({ title, data: buckets[title] }));
  }, [transactions]);

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

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Wallet"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
      />

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
          marginBottom: 16,
          padding: 24,
          overflow: 'hidden',
          borderRadius: 24,
          ...Elevation.primary,
        }}
      >
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

        {balanceQ.loading && balance == null && balanceQ.data == null ? (
          <View className="mt-2 h-10 w-44 rounded-lg bg-white/15" />
        ) : (
          <Text className="text-4xl font-inter-semi tabular-nums text-white mt-1">
            {formatCurrency(balance)}
          </Text>
        )}

        <View className="mt-5 flex-row gap-2">
          <Pressable
            onPress={() => router.push('/(customer)/wallet/top-up')}
            className="flex-1 bg-white py-3.5 items-center"
            style={{ borderRadius: 16 }}
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
            style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }}
            accessibilityRole="button"
            accessibilityLabel="View bookings"
          >
            <Text className="text-sm font-montserrat-bold text-white">
              History
            </Text>
          </Pressable>
        </View>
      </LinearGradient>

      {/* Payment Methods — white card of rows (icon chip • label •
          check) with an "+ Add payment method" footer row in primary
          text, matching the reference wallet layout. */}
      <View className="px-5 mb-2">
        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
          style={{ letterSpacing: 1.4 }}
        >
          Payment methods
        </Text>
        <Card padding="none" className="px-4">
          <View className="flex-row items-center py-3.5">
            <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center mr-3">
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
          <Pressable
            onPress={() => router.push('/(customer)/wallet/top-up')}
            className="flex-row items-center py-3.5"
            accessibilityRole="button"
            accessibilityLabel="Add payment method"
          >
            <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center mr-3">
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
        <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary" style={{ letterSpacing: 1.4 }}>
          Transactions
        </Text>
      </View>
      <SectionList
        sections={txSections}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        renderSectionHeader={({ section: { title } }) => (
          <View className="px-5 pt-3 pb-2 bg-background">
            <Text className="text-[11px] font-montserrat-bold text-textTertiary uppercase tracking-wider">
              {title}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        ListEmptyComponent={
          <EmptyState
            icon={Wallet}
            title="No transactions yet"
            description="Your wallet transaction history will appear here"
          />
        }
      />
    </View>
  );
}
