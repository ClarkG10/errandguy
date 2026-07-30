import React, { useCallback, useRef, useState } from 'react';
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
import { PaymentProgress } from '../../../components/ui/PaymentProgress';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Input } from '../../../components/ui/Input';
import { Hairline } from '../../../components/ui/Typography';
import { formatCurrency } from '../../../utils/formatCurrency';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../../../utils/browser';
import { usePaymentStore, isAttemptActive } from '../../../stores/paymentStore';
import { usePaymentVerification } from '../../../hooks/usePaymentVerification';
import { mapFailureReason } from '../../../utils/paymentErrors';
import { errorMessage } from '../../../utils/errorCatalog';
import { invalidateQuery } from '../../../hooks/useQuery';
import { LightColors, Elevation } from '../../../constants/colors';
import { toast } from '../../../stores/toastStore';
import { copy } from '../../../constants/copy';
import { haptics } from '../../../utils/haptics';

const QUICK_AMOUNTS = [100, 200, 500, 1000];
const TOPUP_METHODS = [
  { key: 'gcash', label: 'GCash', hint: 'Opens the GCash app to approve' },
  { key: 'maya', label: 'Maya', hint: 'Opens the Maya app to approve' },
  { key: 'card', label: 'Credit / Debit Card', hint: 'Secure card checkout' },
] as const;
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
  // How to pay. GCash/Maya charge directly and deep-link into the wallet app
  // (no hosted page); card falls back to the secure Xendit hosted checkout.
  const [method, setMethod] = useState<'gcash' | 'maya' | 'card'>('gcash');

  // ── Money-safety: idempotent attempt + honest verification ──────────────
  const beginAttempt = usePaymentStore((s) => s.beginAttempt);
  const setAttemptStatus = usePaymentStore((s) => s.setStatus);
  const resolveAttempt = usePaymentStore((s) => s.resolve);
  const { attempt, stage: verifyStage, isOffline } = usePaymentVerification();
  const submitLatch = useRef(false);

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

    // Don't start a new top-up while a previous one is still being verified.
    if (isAttemptActive(usePaymentStore.getState().attempt)) {
      toast.info("We're still confirming your last top-up — hang tight.");
      return;
    }
    if (submitLatch.current) return;
    submitLatch.current = true;

    // One attempt = one idempotency key, reused on retry so a double-tap /
    // network retry can never open two invoices or double-charge.
    const payAttempt = beginAttempt({ kind: 'topup', amount: displayAmount, method });
    setLoading(true);
    try {
      // The server creates a Xendit invoice and returns a hosted checkout URL.
      // The wallet is credited ONLY after Xendit confirms via webhook — we
      // never optimistically add funds, and we VERIFY the outcome after.
      const res = await paymentService.topUpWallet(
        { amount: displayAmount, method },
        { idempotencyKey: payAttempt.idempotencyKey },
      );
      const checkoutUrl: string | undefined = res.data?.checkout_url;
      const topupId: string | undefined = res.data?.data?.id;

      if (!checkoutUrl) {
        resolveAttempt();
        toast.error('Could not start checkout. Please try again.');
        return;
      }

      setAttemptStatus('awaiting_gateway', { topupId, checkoutUrl });
      const outcome = await openCheckoutUrl(checkoutUrl, PAYMENT_RETURN_URL);
      if (outcome === 'failed') {
        // Couldn't even open the checkout → nothing was charged.
        resolveAttempt();
        toast.error('Couldn’t open checkout — you weren’t charged. Please try again.');
        return;
      }
      // Any other outcome ('success' | 'cancelled' | 'opened') is inconclusive
      // on its own — a dismissed sheet doesn't prove they didn't pay. VERIFY
      // with the backend; the inline overlay shows the honest result.
      setAttemptStatus('verifying');
    } catch (err: any) {
      resolveAttempt();
      // Honest copy: a gateway 422 (PAYMENT_GATEWAY_ERROR) resolves to
      // "you weren't charged"; anything else falls back to the wallet copy.
      haptics.error();
      toast.error(errorMessage(err, copy.wallet.topupStartFailed));
    } finally {
      setLoading(false);
      submitLatch.current = false;
    }
  }, [displayAmount, method, beginAttempt, setAttemptStatus, resolveAttempt]);

  // Re-open the SAME checkout URL on retry. Only safe for CARD (its hosted
  // Xendit invoice stays payable); a GCash/Maya one-time payment_request URL is
  // DEAD once the charge fails, so retry isn't offered for e-wallets (see the
  // onRetry gate) — the customer starts a fresh top-up instead.
  const retryTopUp = useCallback(async () => {
    const url = usePaymentStore.getState().attempt?.checkoutUrl;
    if (!url) return;
    setAttemptStatus('awaiting_gateway');
    await openCheckoutUrl(url, PAYMENT_RETURN_URL);
    setAttemptStatus('verifying');
  }, [setAttemptStatus]);

  const finishTopUp = useCallback(
    (opts?: { keepAttempt?: boolean }) => {
      if (!opts?.keepAttempt) resolveAttempt();
      invalidateQuery(['wallet']);
      navigateBack();
    },
    [resolveAttempt, navigateBack],
  );

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

        {/* Pay with — chosen up front so GCash/Maya can deep-link straight
            into the wallet app instead of a hosted checkout page. */}
        <Text className="text-[13px] font-montserrat-bold text-textPrimary mt-6 mb-2">
          Pay with
        </Text>
        <View className="rounded-2xl bg-surface overflow-hidden" style={Elevation.sm}>
          {TOPUP_METHODS.map((m, i) => {
            const selected = method === m.key;
            return (
              <Pressable
                key={m.key}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setMethod(m.key);
                }}
                className={`flex-row items-center px-4 py-3.5 ${i > 0 ? 'border-t border-divider' : ''}`}
              >
                <View className="flex-1">
                  <Text className="text-[14px] font-inter-semi text-textPrimary">{m.label}</Text>
                  <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">{m.hint}</Text>
                </View>
                <View
                  className="w-5 h-5 rounded-full items-center justify-center"
                  style={{
                    borderWidth: 2,
                    borderColor: selected ? LightColors.primary : LightColors.dividerStrong,
                    backgroundColor: selected ? LightColors.primary : 'transparent',
                  }}
                >
                  {selected ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* How the charge behaves, honestly, for the chosen method. */}
        <View className="flex-row items-start bg-primaryLight rounded-2xl p-4 mt-4">
          <ShieldCheck size={18} color={LightColors.primary} strokeWidth={2} />
          <Text className="flex-1 ml-2.5 text-[12px] font-montserrat text-textSecondary leading-[17px]">
            {method === 'card'
              ? 'Your card is entered on a secure Xendit checkout page. Your wallet updates automatically once payment is confirmed.'
              : `You'll approve the payment in the ${method === 'gcash' ? 'GCash' : 'Maya'} app, then come straight back. Your wallet updates automatically once it's confirmed.`}
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
        stage={
          attempt?.kind === 'topup' && verifyStage && verifyStage !== 'preparing'
            ? verifyStage
            : null
        }
        offline={isOffline}
        successTitle="Top-up confirmed"
        successCta="View wallet"
        receipt={
          attempt
            ? {
                amount: attempt.amount,
                method: attempt.method,
                paidAt: attempt.paidAt,
                // Include the reference so the top-up receipt is screenshot-able,
                // consistent with the booking + payment-complete receipts.
                reference: attempt.reference,
              }
            : undefined
        }
        onSuccessDone={() => finishTopUp()}
        failureMessage={
          attempt?.failureReason ? mapFailureReason(attempt.failureReason).message : undefined
        }
        onRetry={attempt?.checkoutUrl && attempt?.method === 'card' ? retryTopUp : undefined}
        onClose={() => finishTopUp()}
        onSafeExit={() => finishTopUp()}
      />
      </KeyboardAvoidingView>
    </View>
  );
}
