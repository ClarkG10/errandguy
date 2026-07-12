import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ShieldCheck, Check } from 'lucide-react-native';
import { paymentService } from '../../../services/payment.service';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { PaymentProgress, type PaymentStage } from '../../../components/ui/PaymentProgress';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Input } from '../../../components/ui/Input';
import { Hairline } from '../../../components/ui/Typography';
import { formatCurrency } from '../../../utils/formatCurrency';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../../../utils/browser';
import { LightColors, Elevation } from '../../../constants/colors';
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
  const insets = useSafeAreaInsets();

  const [amount, setAmount] = useState(0);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [payStage, setPayStage] = useState<PaymentStage | null>(null);

  const displayAmount = customAmount ? parseFloat(customAmount) || 0 : amount;

  const navigateBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(customer)/wallet');
    }
  }, [router]);

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
    // Staged overlay: "Opening secure checkout…" while the invoice is created
    // and the sheet opens (the native sheet floats above this frame).
    setPayStage('redirecting');
    try {
      // The server creates a Xendit invoice and returns a hosted checkout
      // URL. We open it so the customer can pay with GCash/Maya/card; the
      // wallet is credited only after Xendit confirms via webhook — so we
      // do NOT optimistically add funds here.
      const res = await paymentService.topUpWallet({ amount: displayAmount });
      const checkoutUrl: string | undefined = res.data?.checkout_url;

      if (!checkoutUrl) {
        setPayStage(null);
        toast.error('Could not start checkout. Please try again.');
        return;
      }

      const outcome = await openCheckoutUrl(checkoutUrl, PAYMENT_RETURN_URL);
      if (outcome === 'failed') {
        setPayStage(null);
        toast.error('Could not open checkout. Please try again.');
        return;
      }
      // Outcome must reflect reality — money in motion must never leave an
      // ambiguous state.
      if (outcome === 'cancelled') {
        // User closed the sheet without paying — imply NO pending credit.
        setPayStage(null);
        toast.info('Top-up cancelled — no payment was made.');
        navigateBack();
        return;
      }
      if (outcome === 'success') {
        // The in-app sheet redirected back to our return URL — the same
        // signal payment-complete.tsx treats as done. Show the success frame
        // (it navigates back once the check settles); the balance still
        // reconciles via the Xendit webhook.
        setPayStage('success');
        return;
      }
      // 'opened' — plain sheet with no return signal; we can't claim success.
      setPayStage(null);
      toast.info('Your balance will update once your payment is confirmed.');
      navigateBack();
    } catch (err: any) {
      setPayStage(null);
      toast.error(err?.response?.data?.message ?? 'Failed to start top-up');
    } finally {
      setLoading(false);
    }
  }, [displayAmount, navigateBack]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Add Money"
        showBack
        fallbackHref="/(customer)/wallet"
      />

      {/* Lift the amount input + CTA above the decimal-pad. That keyboard
          has no Done key on iOS, so without this the absolute CTA (which
          mirrors the entered amount) is covered and the user is trapped;
          on-drag dismiss gives an escape hatch. Mirrors (runner)/payout. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // The header renders OUTSIDE this KAV, so its frame already starts
        // below the band — no offset to compensate for. A non-zero offset
        // here over-lifts, leaving a dead gap between the keyboard top and
        // the (padding-lifted) absolute CTA.
        keyboardVerticalOffset={0}
      >
      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
      >
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
              style={({ pressed }) => pressed && { opacity: 0.7 }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${formatCurrency(amt)}`}
              accessibilityState={{ selected: amount === amt && !customAmount }}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setAmount(amt);
                setCustomAmount('');
              }}
            >
              <Text
                className={`text-sm font-inter-semi tabular-nums ${
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
          // Bounds belong to the field — route them through the Input's
          // helper slot so they hug it (a detached caption below the
          // field's own 16px margin reads as belonging to the next block).
          helperText={`Min ${formatCurrency(MIN_TOPUP)} · Max ${formatCurrency(MAX_TOPUP)}`}
        />

        {/* Secure checkout note — method is chosen on the Xendit page. */}
        <View className="flex-row items-start bg-primaryLight rounded-2xl p-4 mt-5">
          <ShieldCheck size={18} color={LightColors.primary} strokeWidth={2} />
          <Text className="flex-1 ml-2.5 text-[12px] font-montserrat text-textSecondary leading-[17px]">
            You&apos;ll choose GCash, Maya, or card on a secure Xendit checkout page. Your wallet updates automatically once payment is confirmed.
          </Text>
        </View>

        {/* Amount transparency — a money-in funnel handing off to a third
            party must state the charge contract on-screen before the user
            commits. ErrandGuy adds no top-up fee, so the amount charged
            equals the amount credited; the explicit line closes the gap. */}
        {displayAmount >= MIN_TOPUP && displayAmount <= MAX_TOPUP ? (
          <View
            className="rounded-2xl bg-surface p-4 mt-5"
            style={Elevation.sm}
          >
            <View className="flex-row items-center justify-between py-1.5">
              <Text className="text-[13px] font-montserrat text-textSecondary">
                Amount
              </Text>
              <Text className="text-[14px] font-inter-semi tabular-nums text-textPrimary">
                {formatCurrency(displayAmount)}
              </Text>
            </View>
            <Hairline className="my-1" />
            <View className="flex-row items-center justify-between py-1.5">
              <Text className="text-[13px] font-montserrat-bold text-textPrimary">
                Wallet receives
              </Text>
              <Text className="text-[15px] font-inter-semi tabular-nums text-primary">
                {formatCurrency(displayAmount)}
              </Text>
            </View>
            <View className="flex-row items-center mt-2">
              <Check size={14} color={LightColors.successDark} strokeWidth={2.4} />
              <Text className="flex-1 ml-1.5 text-[11px] font-montserrat text-textSecondary">
                No added fees — you&apos;re charged exactly {formatCurrency(displayAmount)}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Bottom CTA */}
      <BottomActionBar>
        <Button
          title={`Add ${displayAmount > 0 ? formatCurrency(displayAmount) : 'Money'}`}
          onPress={handleTopUp}
          disabled={displayAmount < MIN_TOPUP || displayAmount > MAX_TOPUP}
          loading={loading}
          loadingTitle="Processing…"
          fullWidth
        />
      </BottomActionBar>

      <PaymentProgress
        stage={payStage}
        successTitle="Payment received"
        onSuccessDone={navigateBack}
        onClose={() => setPayStage(null)}
      />
      </KeyboardAvoidingView>
    </View>
  );
}
