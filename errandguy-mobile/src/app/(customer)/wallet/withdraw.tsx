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
import { AlertTriangle, Gift, ShieldCheck } from 'lucide-react-native';
import { paymentService } from '../../../services/payment.service';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Input } from '../../../components/ui/Input';
import { Skeleton } from '../../../components/ui/Skeleton';
import { PayoutDestinationForm } from '../../../components/payout/PayoutDestinationForm';
import { useWalletSummary } from '../../../hooks/useWalletSummary';
import { useAuthStore } from '../../../stores/authStore';
import { shouldRetainIdempotencyKey } from '../../../stores/paymentStore';
import { toast } from '../../../stores/toastStore';
import { formatCurrency } from '../../../utils/formatCurrency';
import { newIdempotencyKey } from '../../../utils/idempotency';
import { withdrawAmountProblem, withdrawMinimum } from '../../../utils/withdrawal';
import { errorMessage } from '../../../utils/errorCatalog';
import { haptics } from '../../../utils/haptics';
import {
  EMPTY_PAYOUT_DESTINATION,
  maskedDestination,
  payoutDestinationServerErrors,
  toPayoutDestinationPayload,
  validatePayoutDestination,
  type PayoutDestinationDraft,
  type PayoutDestinationErrors,
} from '../../../utils/payoutDestination';
import { LightColors, Elevation } from '../../../constants/colors';
import { copy } from '../../../constants/copy';
import type { PayoutChannel } from '../../../types';

/** Customers withdraw to an e-wallet; banks are for runner payouts. */
const WITHDRAW_CHANNELS: readonly PayoutChannel[] = ['gcash', 'maya'];

// Digits and a single decimal point, two decimal places at most — so "1.2.3"
// or "abc" can't reach a confusing parseFloat.
function sanitizeAmount(input: string): string {
  let cleaned = input.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    const [whole, frac = ''] = cleaned.split('.');
    cleaned = `${whole}.${frac.slice(0, 2)}`;
  }
  if (/^0\d/.test(cleaned)) cleaned = cleaned.replace(/^0+/, '');
  return cleaned;
}

/**
 * Withdraw wallet money to GCash or Maya.
 *
 * POST /wallet/withdraw debits the balance NOW and queues a pending payout
 * that staff send by hand (usually within 1–3 business days); the customer is
 * notified when it is sent, and a payout that bounces comes back to the
 * wallet. Money-out, so the request is idempotent: one Idempotency-Key per
 * withdrawal, kept across a failure whose outcome is unknown so a retry
 * replays the first one instead of debiting twice.
 */
export default function WithdrawScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fullName = useAuthStore((s) => s.user?.full_name ?? '');
  const summaryQ = useWalletSummary();
  const withdrawable = summaryQ.data?.withdrawable ?? null;
  const bonusCredit = summaryQ.data?.bonus_balance ?? 0;
  // The server's own floor (GET /wallet/balance `withdraw_min`, ₱100 if an
  // older server doesn't send it). Checked here so a withdrawal under it is
  // explained up front rather than refused after the confirm dialog.
  const minWithdraw = withdrawMinimum(summaryQ.data);

  const [amountInput, setAmountInput] = useState('');
  const [destination, setDestination] = useState<PayoutDestinationDraft>(() => ({
    ...EMPTY_PAYOUT_DESTINATION,
    accountName: fullName,
  }));
  const [fieldErrors, setFieldErrors] = useState<PayoutDestinationErrors>({});
  const [amountError, setAmountError] = useState<string | null>(null);
  // The server's refusal in its own words (not enough balance, money owed
  // from cash errands, a minimum) — shown on the screen, not just a toast.
  const [serverError, setServerError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Synchronous latch: closes the double-tap window before `submitting` lands.
  const latch = useRef(false);
  // The Idempotency-Key and the exact body it was sent with. The server hashes
  // the body, so a changed withdrawal must never reuse it (that's a 422).
  const keyRef = useRef<{ key: string; sig: string } | null>(null);

  const amount = parseFloat(amountInput) || 0;
  const nothingToWithdraw = withdrawable != null && withdrawable <= 0;
  // Some money, but less than the smallest withdrawal the server accepts:
  // say so instead of offering a form that can only be refused.
  const belowMinimum = withdrawable != null && withdrawable > 0 && withdrawable < minWithdraw;

  const navigateBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(customer)/wallet');
  }, [router]);

  const review = () => {
    setServerError(null);
    const amountProblem = withdrawAmountProblem(amount, withdrawable, minWithdraw);
    const errors = validatePayoutDestination(destination, WITHDRAW_CHANNELS);
    setAmountError(amountProblem);
    setFieldErrors(errors);
    if (amountProblem || Object.keys(errors).length > 0) {
      haptics.warning();
      return;
    }
    setShowConfirm(true);
  };

  const confirm = async () => {
    if (latch.current) return;
    latch.current = true;
    const payload = {
      amount,
      ...(toPayoutDestinationPayload(destination) as {
        channel: 'gcash' | 'maya';
        account_number: string;
        account_name: string;
      }),
    };
    const sig = JSON.stringify(payload);
    if (!keyRef.current || keyRef.current.sig !== sig) {
      keyRef.current = { key: newIdempotencyKey(), sig };
    }
    setSubmitting(true);
    try {
      const res = await paymentService.withdraw(payload, { idempotencyKey: keyRef.current.key });
      // The server answered (a replay of the first one included): this key is
      // spent — the next withdrawal is a new one.
      keyRef.current = null;
      setShowConfirm(false);
      haptics.success();
      toast.success(res.data?.message ?? copy.wallet.withdrawalRequested);
      navigateBack();
    } catch (err: any) {
      // Unknown outcome (timeout / offline / 5xx / 409 in flight) → keep the
      // key so the retry replays this withdrawal. A definitive refusal → the
      // next try is a new one.
      if (!shouldRetainIdempotencyKey(err)) keyRef.current = null;
      setShowConfirm(false);
      haptics.error();
      const fields = payoutDestinationServerErrors(err);
      setFieldErrors(fields);
      const message = errorMessage(err, copy.wallet.withdrawalFailed);
      if (err?.code === 'PAYOUT_MIN_AMOUNT') {
        // Under the minimum: the server names it, and it belongs on the
        // amount. The floor may have moved since we read it — re-read.
        setAmountError(message);
        setServerError(null);
        void summaryQ.refresh();
      } else {
        setServerError(message);
      }
      // The balance moved under us (or a debt appeared) — re-read it.
      if (err?.code === 'INSUFFICIENT_WALLET_BALANCE' || err?.code === 'CASH_DEBT_OUTSTANDING') {
        void summaryQ.refresh();
      }
    } finally {
      setSubmitting(false);
      latch.current = false;
    }
  };

  const destinationLabel = maskedDestination(destination.channel, destination.accountNumber);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Withdraw" showBack fallbackHref="/(customer)/wallet" />

      {/* Lift the inputs + CTA above the keyboard; the decimal-pad has no Done
          key on iOS, so on-drag dismiss is the escape hatch. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          className="flex-1 px-5"
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        >
          {/* What can go out — the withdrawable balance only. */}
          <View className="rounded-2xl bg-surface p-4 mb-5" style={Elevation.sm}>
            <Text className="text-[11px] font-montserrat-bold uppercase tracking-wider text-textSecondary">
              Available to withdraw
            </Text>
            {withdrawable == null ? (
              <Skeleton width={140} height={28} borderRadius={6} style={{ marginTop: 6 }} />
            ) : (
              <Text className="text-[26px] font-inter-semi tabular-nums text-textPrimary mt-1">
                {formatCurrency(withdrawable)}
              </Text>
            )}
            {bonusCredit > 0 ? (
              <View className="flex-row items-start mt-2">
                <Gift size={13} color={LightColors.accentStrong} strokeWidth={2} style={{ marginTop: 2 }} />
                <Text className="flex-1 ml-1.5 text-[12px] font-montserrat text-textSecondary">
                  Your {formatCurrency(bonusCredit)} bonus credit stays in your wallet — spend it on
                  errands. It can’t be withdrawn.
                </Text>
              </View>
            ) : null}
          </View>

          {nothingToWithdraw ? (
            <Text className="text-[13px] font-montserrat text-textSecondary mb-4">
              There’s nothing to withdraw yet. Refunds and other credits land in your wallet, and
              you can withdraw them here.
            </Text>
          ) : belowMinimum ? (
            <Text className="text-[13px] font-montserrat text-textSecondary mb-4">
              The minimum withdrawal is {formatCurrency(minWithdraw)}. Your{' '}
              {formatCurrency(withdrawable ?? 0)} stays in your wallet — use it on your next errand,
              or withdraw once you have {formatCurrency(minWithdraw)} or more.
            </Text>
          ) : (
            <>
              <Input
                label="Amount"
                value={amountInput}
                onChangeText={(v) => {
                  setAmountInput(sanitizeAmount(v));
                  setAmountError(null);
                  setServerError(null);
                }}
                placeholder="₱0.00"
                keyboardType="decimal-pad"
                error={amountError ?? undefined}
                helperText={
                  withdrawable != null
                    ? `Minimum ${formatCurrency(minWithdraw)} · up to ${formatCurrency(withdrawable)}`
                    : `Minimum ${formatCurrency(minWithdraw)}`
                }
              />
              {withdrawable != null && withdrawable >= minWithdraw ? (
                <Pressable
                  onPress={() => {
                    setAmountInput(withdrawable.toFixed(2));
                    setAmountError(null);
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Withdraw all, ${formatCurrency(withdrawable)}`}
                  className="self-start -mt-2 mb-5"
                >
                  <Text className="text-[13px] font-montserrat-semi text-primary">Withdraw all</Text>
                </Pressable>
              ) : null}

              <Text className="text-[13px] font-montserrat-bold text-textPrimary mb-2">Send to</Text>
              <PayoutDestinationForm
                value={destination}
                onChange={(next) => {
                  setDestination(next);
                  setFieldErrors({});
                  setServerError(null);
                }}
                channels={WITHDRAW_CHANNELS}
                errors={fieldErrors}
              />

              {serverError ? (
                <View
                  className="flex-row items-start rounded-xl bg-dangerSoft px-3 py-2.5 mt-1 mb-3"
                  accessibilityLiveRegion="polite"
                >
                  <AlertTriangle size={16} color={LightColors.dangerDark} strokeWidth={2} style={{ marginTop: 1 }} />
                  <Text className="flex-1 ml-2 text-[13px] font-montserrat text-dangerDark">
                    {serverError}
                  </Text>
                </View>
              ) : null}

              {/* How it goes out, honestly: by hand, not instantly. */}
              <View className="flex-row items-start bg-divider rounded-2xl p-4 mt-2">
                <ShieldCheck size={18} color={LightColors.primary} strokeWidth={2} />
                <Text className="flex-1 ml-2.5 text-[12px] font-montserrat text-textSecondary leading-[17px]">
                  The amount leaves your wallet now and our team sends it — it usually arrives
                  within 1–3 business days. We’ll notify you when it’s sent, and if it can’t go
                  through, the money comes back to your wallet.
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        <BottomActionBar>
          <Button
            title={amount >= 1 ? `Withdraw ${formatCurrency(amount)}` : 'Withdraw'}
            onPress={review}
            disabled={
              withdrawable == null ||
              nothingToWithdraw ||
              belowMinimum ||
              amount <= 0 ||
              !destination.channel
            }
            loading={submitting}
            loadingTitle="Requesting…"
            fullWidth
          />
        </BottomActionBar>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={showConfirm}
        title={`Withdraw ${formatCurrency(amount)}?`}
        message={`We’ll send it to ${destinationLabel ?? 'your account'}${
          destination.accountName.trim() ? ` (${destination.accountName.trim()})` : ''
        }. It usually arrives within 1–3 business days. Check the number — money sent to the wrong account can’t be pulled back.`}
        confirmLabel="Withdraw"
        confirmLoadingLabel="Requesting…"
        loading={submitting}
        onConfirm={confirm}
        onCancel={() => setShowConfirm(false)}
      />
    </View>
  );
}
