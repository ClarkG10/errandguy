import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { paymentService } from '../../../services/payment.service';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Input } from '../../../components/ui/Input';
import { formatCurrency } from '../../../utils/formatCurrency';
import { openCheckoutUrl } from '../../../utils/browser';
import { LightColors } from '../../../constants/colors';
import { toast } from '../../../stores/toastStore';

const QUICK_AMOUNTS = [100, 200, 500, 1000];
// Sanity bounds enforced client-side so the user gets immediate feedback
// instead of round-tripping a 422. Mirror the server's WalletController
// validation (min:50, max:50000) so client + server agree.
const MIN_TOPUP = 50;
const MAX_TOPUP = 50_000;

// Strip anything that isn't a digit or a single decimal point, then
// clamp to two decimal places. Prevents "100abc" / "1.2.3" / "1.999"
// from becoming a confusing parseFloat result.
function sanitizeAmount(input: string): string {
  let cleaned = input.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    const [whole, frac = ''] = cleaned.split('.');
    cleaned = `${whole}.${frac.slice(0, 2)}`;
  }
  // Strip leading zeros except for "0.xx"
  if (/^0\d/.test(cleaned)) cleaned = cleaned.replace(/^0+/, '');
  return cleaned;
}

export default function TopUpScreen() {
  const router = useRouter();

  const [amount, setAmount] = useState(0);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const displayAmount = customAmount ? parseFloat(customAmount) || 0 : amount;

  const handleTopUp = useCallback(async () => {
    if (displayAmount < MIN_TOPUP) {
      toast.error(`Minimum amount is ${formatCurrency(MIN_TOPUP)}`);
      return;
    }
    if (displayAmount > MAX_TOPUP) {
      toast.error(`Maximum amount is ${formatCurrency(MAX_TOPUP)}`);
      return;
    }

    setLoading(true);
    try {
      // The server creates a Xendit invoice and returns a hosted checkout
      // URL. We open it so the customer can pay with GCash/Maya/card; the
      // wallet is credited only after Xendit confirms via webhook — so we
      // do NOT optimistically add funds here.
      const res = await paymentService.topUpWallet({ amount: displayAmount });
      const checkoutUrl: string | undefined = res.data?.checkout_url;

      if (!checkoutUrl) {
        toast.error('Could not start checkout. Please try again.');
        return;
      }

      await openCheckoutUrl(checkoutUrl);
      // Back from the payment page — the balance updates once the webhook
      // confirms. Tell the user and return to the wallet, which refetches.
      toast.info('Your balance will update once your payment is confirmed.');
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(customer)/wallet');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to start top-up');
    } finally {
      setLoading(false);
    }
  }, [displayAmount, router]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Add Money"
        showBack
        fallbackHref="/(customer)/wallet"
      />

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
            setCustomAmount(sanitizeAmount(v));
            setAmount(0);
          }}
          placeholder="₱0.00"
          keyboardType="decimal-pad"
        />
        <Text className="text-[11px] font-montserrat text-textTertiary mt-1 ml-1">
          Min {formatCurrency(MIN_TOPUP)} · Max {formatCurrency(MAX_TOPUP)}
        </Text>

        {/* Secure checkout note — method is chosen on the Xendit page. */}
        <View className="flex-row items-start bg-primaryLight rounded-2xl p-4 mt-5">
          <ShieldCheck size={18} color={LightColors.primary} strokeWidth={2} />
          <Text className="flex-1 ml-2.5 text-[12px] font-montserrat text-textSecondary leading-[17px]">
            You&apos;ll choose GCash, Maya, or card on a secure Xendit checkout page. Your wallet updates automatically once payment is confirmed.
          </Text>
        </View>

        <View className="h-24" />
      </ScrollView>

      {/* Bottom CTA */}
      <BottomActionBar>
        <Button
          title={`Add ${displayAmount > 0 ? formatCurrency(displayAmount) : 'Money'}`}
          onPress={handleTopUp}
          disabled={displayAmount < MIN_TOPUP || displayAmount > MAX_TOPUP}
          loading={loading}
          fullWidth
        />
      </BottomActionBar>
    </View>
  );
}
