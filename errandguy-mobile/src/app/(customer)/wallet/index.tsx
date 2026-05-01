import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  RefreshControl,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  Star,
  Wallet,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWalletStore } from '../../../stores/walletStore';
import { useAuthStore } from '../../../stores/authStore';
import { paymentService } from '../../../services/payment.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatRelativeTime } from '../../../utils/formatDate';
import type { WalletTransaction, WalletTransactionType } from '../../../types';
import { toast } from '../../../stores/toastStore';

const TX_ICONS: Record<WalletTransactionType, { icon: LucideIcon; color: string }> = {
  top_up: { icon: ArrowUpCircle, color: '#22C55E' },
  payment: { icon: ArrowDownCircle, color: '#EF4444' },
  refund: { icon: RotateCcw, color: '#2563EB' },
  payout: { icon: ArrowDownCircle, color: '#F59E0B' },
  bonus: { icon: Star, color: '#F59E0B' },
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
        <View className="flex-row items-center px-5 py-3 border-b border-divider">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: config.color + '20' }}
          >
            <Icon size={20} color={config.color} />
          </View>
          <View className="flex-1">
            <Text
              className="text-sm font-montserrat-bold text-textPrimary"
              numberOfLines={1}
            >
              {item.display_description ?? item.description ?? item.type.replace('_', ' ')}
            </Text>
            <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
              {formatRelativeTime(item.created_at)}
            </Text>
          </View>
          <View className="items-end">
            <Text
              className={`text-sm font-inter-semi tabular-nums ${
                isPositive ? 'text-success' : 'text-danger'
              }`}
            >
              {isPositive ? '+' : '-'}
              {formatCurrency(Math.abs(item.amount))}
            </Text>
            <Text className="text-[10px] font-inter tabular-nums text-textSecondary mt-0.5">
              Bal: {formatCurrency(item.balance_after)}
            </Text>
          </View>
        </View>
      );
    },
    [],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4">
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(customer)/(tabs)/profile')}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          className="mr-3 w-9 h-9 rounded-xl bg-surface items-center justify-center"
          style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </Pressable>
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          Wallet
        </Text>
      </View>

      {/* Balance Card
          A solid blue tile competed visually with the brand primary
          everywhere else and made the wallet feel like just another
          CTA. We swapped to a deep slate card (premium fintech feel)
          with a subtle blue accent ring around the amount and a
          slightly recessed top-up pill. The amount now uses our
          tabular-nums Inter face on a #0F172A base for proper
          currency emphasis. */}
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
        {/* Decorative blue glow blob — adds depth without painting the
            whole card brand-blue. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -40,
            right: -40,
            width: 160,
            height: 160,
            borderRadius: 80,
            backgroundColor: '#2563EB',
            opacity: 0.22,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: -60,
            left: -30,
            width: 140,
            height: 140,
            borderRadius: 70,
            backgroundColor: '#3B82F6',
            opacity: 0.12,
          }}
        />

        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-xs font-montserrat-semi text-white/60 uppercase tracking-wider">
            Available Balance
          </Text>
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
            className="flex-1 bg-white py-3 rounded-2xl items-center"
            accessibilityRole="button"
            accessibilityLabel="Add money to wallet"
          >
            <Text className="text-sm font-montserrat-bold text-textPrimary">
              Add Money
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(customer)/(tabs)/activity' as any)}
            className="flex-1 bg-white/10 py-3 rounded-2xl items-center border border-white/15"
            accessibilityRole="button"
            accessibilityLabel="View bookings"
          >
            <Text className="text-sm font-montserrat-bold text-white">
              History
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Transactions */}
      <Text className="text-base font-montserrat-bold text-textPrimary px-5 mb-2">
        Transactions
      </Text>
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
    </SafeAreaView>
  );
}
