import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
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
import { paymentService } from '../../../services/payment.service';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatRelativeTime } from '../../../utils/formatDate';
import type { WalletTransaction, WalletTransactionType } from '../../../types';

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
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [balRes, txRes] = await Promise.all([
        paymentService.getWalletBalance(),
        paymentService.getWalletTransactions(),
      ]);
      setBalance(balRes.data.data?.balance ?? 0);
      setTransactions(txRes.data.data ?? []);
    } catch {
      // Handle error
    }
  }, [setBalance, setTransactions]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

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
            <Text className="text-sm font-montserrat-bold text-textPrimary">
              {item.description ?? item.type.replace('_', ' ')}
            </Text>
            <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
              {formatRelativeTime(item.created_at)}
            </Text>
          </View>
          <View className="items-end">
            <Text
              className={`text-sm font-montserrat-bold ${
                isPositive ? 'text-success' : 'text-danger'
              }`}
            >
              {isPositive ? '+' : '-'}
              {formatCurrency(Math.abs(item.amount))}
            </Text>
            <Text className="text-[10px] font-montserrat text-textSecondary mt-0.5">
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
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          Wallet
        </Text>
      </View>

      {/* Balance Card */}
      <View className="mx-5 bg-primary rounded-2xl p-6 mb-4">
        <Text className="text-sm font-montserrat text-white/80">
          Available Balance
        </Text>
        <Text className="text-3xl font-montserrat-bold text-white mt-1">
          {formatCurrency(balance)}
        </Text>
        <View className="mt-4">
          <Button
            title="Top Up"
            variant="secondary"
            onPress={() => router.push('/(customer)/wallet/top-up')}
            fullWidth
          />
        </View>
      </View>

      {/* Transactions */}
      <Text className="text-base font-montserrat-bold text-textPrimary px-5 mb-2">
        Transactions
      </Text>
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
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
