import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWalletStore } from '../../../stores/walletStore';
import { paymentService } from '../../../services/payment.service';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { PaymentMethodSelector } from '../../../components/customer/PaymentMethodSelector';
import { formatCurrency } from '../../../utils/formatCurrency';

const QUICK_AMOUNTS = [100, 200, 500, 1000];

export default function TopUpScreen() {
  const router = useRouter();
  const { setBalance, addTransaction } = useWalletStore();

  const [amount, setAmount] = useState(0);
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState<string>();
  const [loading, setLoading] = useState(false);

  const displayAmount = customAmount ? parseFloat(customAmount) || 0 : amount;

  const handleTopUp = useCallback(async () => {
    if (displayAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    if (!paymentMethodId) {
      Alert.alert('Error', 'Please select a payment method');
      return;
    }

    setLoading(true);
    try {
      const res = await paymentService.topUpWallet({
        amount: displayAmount,
        payment_method_id: paymentMethodId,
      });
      const tx = res.data.data;
      if (tx) {
        addTransaction(tx);
      }
      Alert.alert('Success', `${formatCurrency(displayAmount)} added to wallet`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.response?.data?.message ?? 'Failed to top up wallet',
      );
    } finally {
      setLoading(false);
    }
  }, [displayAmount, paymentMethodId, addTransaction, router]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          Top Up Wallet
        </Text>
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        {/* Quick Amounts */}
        <Text className="text-sm font-montserrat-bold text-textPrimary mb-3">
          Select Amount
        </Text>
        <View className="flex-row gap-3 mb-4">
          {QUICK_AMOUNTS.map((amt) => (
            <Pressable
              key={amt}
              className={`flex-1 py-4 rounded-xl border items-center ${
                amount === amt && !customAmount
                  ? 'bg-primaryLight border-primary'
                  : 'bg-surface border-divider'
              }`}
              onPress={() => {
                setAmount(amt);
                setCustomAmount('');
              }}
            >
              <Text
                className={`text-sm font-montserrat-bold ${
                  amount === amt && !customAmount
                    ? 'text-primary'
                    : 'text-textPrimary'
                }`}
              >
                {formatCurrency(amt)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Custom Amount */}
        <Input
          label="Or enter custom amount"
          value={customAmount}
          onChangeText={(v) => {
            setCustomAmount(v);
            setAmount(0);
          }}
          placeholder="₱0.00"
          keyboardType="numeric"
        />

        {/* Payment Method */}
        <PaymentMethodSelector
          selectedId={paymentMethodId}
          onSelect={setPaymentMethodId}
        />

        <View className="h-24" />
      </ScrollView>

      {/* Bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <Button
          title={`Top Up ${displayAmount > 0 ? formatCurrency(displayAmount) : ''}`}
          onPress={handleTopUp}
          disabled={displayAmount <= 0 || !paymentMethodId}
          loading={loading}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}
