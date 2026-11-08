import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  Wallet,
  Smartphone,
  Landmark,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertTriangle,
  ChevronRight,
  AlertCircle,
  Check,
} from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { Skeleton } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';
import { RunnerEmptyState } from '../../../components/ui/RunnerEmptyState';
import { SuccessCheck } from '../../../components/ui/SuccessCheck';
import { WalletActivityRow } from '../../../components/runner/WalletActivityRow';
import { PayoutDestinationForm } from '../../../components/payout/PayoutDestinationForm';
import { PaymentBrandMark } from '../../../components/customer/PaymentBrandMark';
import {
  payoutMinimum,
  resolvePayoutMethod,
  type PayoutMethodState,
  type SelfRunnerProfile,
} from '../../../components/runner/payoutMethod';
import {
  EMPTY_PAYOUT_DESTINATION,
  payoutDestinationServerErrors,
  toPayoutDestinationPayload,
  validatePayoutDestination,
  type PayoutDestinationDraft,
  type PayoutDestinationErrors,
} from '../../../utils/payoutDestination';
import { cashDebtText } from '../../../utils/cashDebt';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { userService } from '../../../services/user.service';
import { runnerService } from '../../../services/runner.service';
import { paymentService } from '../../../services/payment.service';
import { newIdempotencyKey } from '../../../utils/idempotency';
import { useQuery } from '../../../hooks/useQuery';
import { useResponsive } from '../../../constants/responsive';
import { CacheTTL } from '../../../services/cache.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatMonthDay, formatMonthDayTime } from '../../../utils/formatDate';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { haptics } from '../../../utils/haptics';
import type { PayoutChannel, WalletTransaction } from '../../../types';
import { LightColors, Elevation } from '../../../constants/colors';
import { PAYOUT_ACTIVITY_PREVIEW } from '../../../services/preload.service';

/** A runner can be paid to GCash, Maya or a bank account. */
const RUNNER_PAYOUT_CHANNELS: readonly PayoutChannel[] = ['gcash', 'maya', 'bank'];

/** The form, pre-filled from what is saved (a bank account number never
 *  comes back from the server, so it is always typed fresh — which is exactly
 *  what a bank saved without one needs). */
function draftFromMethod(
  method: PayoutMethodState,
  profile: SelfRunnerProfile | null,
  fallbackName: string,
): PayoutDestinationDraft {
  const channel =
    method.channel ?? (method.blocker === 'incomplete_bank' ? 'bank' : null);
  const isEwallet = channel === 'gcash' || channel === 'maya';
  return {
    ...EMPTY_PAYOUT_DESTINATION,
    channel,
    accountNumber:
      isEwallet || method.needsChannel ? (profile?.ewallet_number ?? '').trim() : '',
    accountName: method.accountName ?? fallbackName,
    bankName: channel === 'bank' ? method.bankName ?? '' : '',
  };
}

/** How many ledger rows the inline "Wallet activity" preview shows. */
// Owned by preload.service so the prefetch and this screen cannot request
// different page sizes (a divergence would make the warm-up a no-op).
const ACTIVITY_PREVIEW = PAYOUT_ACTIVITY_PREVIEW;

/**
 * Whole-peso display for the payout-progress line — "₱65 of ₱100".
 * Mirrors the runner home daily-goal bar's peso formatting so the two
 * progress surfaces read as one visual family.
 *
 * Progress is FLOORED and the target CEILED: rounding ₱99.60 up read
 * "₱100 of ₱100 needed" while the payout stayed locked. A whole-peso line
 * must never claim more than the runner has.
 */
const pesos = (v: number, round: (n: number) => number = Math.floor) =>
  `₱${round(v).toLocaleString('en-PH')}`;

/** "Nov 3, 2:30 PM" via the app's formatter, not the device locale (which
 *  read "3 Nov, 14:30" on a UK/24h phone beside "Nov 3" everywhere else). ''
 *  for a missing or malformed timestamp. */
function fmtPayoutDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatMonthDayTime(iso);
}

// Same digits-only-with-one-decimal sanitiser used elsewhere; prevents
// "100.5.6" or "abc" from passing through to a bad parseFloat.
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

export default function PayoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { contentMaxWidth } = useResponsive();
  const { runnerProfile: storedProfile, setRunnerProfile } = useRunnerStore();
  // RunnerProfileResource returns bank_account_last4 + payout_minimum for the
  // OWNING runner; the shared RunnerProfile type doesn't declare them yet.
  const runnerProfile = storedProfile as SelfRunnerProfile | null;
  // The withdrawable balance lives on the User row (wallet_balance), NOT
  // on RunnerProfile.total_earnings (which is a lifetime counter and
  // never decreases on payout). Using total_earnings here used to let a
  // runner re-request the same lifetime amount even after they had
  // already withdrawn it.
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const balance = Number(user?.wallet_balance ?? 0);
  // The payout floor is a SERVER value (SystemConfig min_payout_amount) — the
  // screen used to hardcode ₱100, so an admin tuning the config either blocked
  // legal requests locally or let runners submit doomed ones. 100 stays the
  // fallback (never 0, which would un-gate the button into server 422s).
  const minPayout = payoutMinimum(runnerProfile);
  // Runner has money but can't cash out yet — turn the "Min ₱100" dead-end
  // on the balance card into forward motion toward their first payout.
  const belowMinimum = balance > 0 && balance < minPayout;
  const payoutProgress = Math.max(0, Math.min(1, balance / minPayout));
  // A cash-heavy runner can go NEGATIVE by design (unpaid platform commission
  // on cash errands). A bare "-₱240.00" under "Available for payout" with no
  // explanation is the single most alarming thing on this screen.
  const owesCommission = balance < 0;

  // Everything the payout REQUEST is really gated on, mirrored from
  // RunnerProfile::payoutDestination so the runner is told before they submit.
  const method = useMemo(() => resolvePayoutMethod(runnerProfile), [runnerProfile]);

  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  // The method form shows when nothing usable is saved, or after "Change".
  const [editingMethod, setEditingMethod] = useState(false);
  const showMethodForm = editingMethod || !method.ready;
  const [methodDraft, setMethodDraft] = useState<PayoutDestinationDraft>(() =>
    draftFromMethod(method, runnerProfile, user?.full_name ?? ''),
  );
  const [methodErrors, setMethodErrors] = useState<PayoutDestinationErrors>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  // Pattern 10 — after a request is accepted: the big check, the amount, where
  // it goes and when, then one way on. Null = not showing.
  const [payoutSuccess, setPayoutSuccess] = useState<{
    amount: number;
    to: string | null;
    message: string | null;
  } | null>(null);

  // Until the runner starts typing, the form follows the saved method — the
  // mount refresh may land after the first render (an incomplete bank then
  // pre-fills its name). Once touched, a background refresh never overwrites
  // what they typed; a save or a cancel hands control back.
  const methodFormTouched = useRef(false);
  useEffect(() => {
    if (methodFormTouched.current) return;
    setMethodDraft(draftFromMethod(method, runnerProfile, user?.full_name ?? ''));
  }, [method, runnerProfile, user?.full_name]);

  const requestedAmount = parseFloat(amountInput) || 0;

  // Reason the Request button is blocked, surfaced inline so a disabled
  // button is recoverable instead of a dead end. Only shown once the
  // runner has actually typed something invalid.
  const amountError =
    amountInput.trim() === ''
      ? null
      : requestedAmount > 0 && requestedAmount < minPayout
      ? `The minimum payout is ${formatCurrency(minPayout)}. Enter at least that much.`
      : requestedAmount > balance
      ? balance > 0
        ? `That's more than your ${formatCurrency(balance)} available. Lower it, or tap Withdraw all.`
        : 'There’s nothing available to withdraw yet.'
      : null;
  // A check really ran on this amount (minimum and balance) and it passed.
  const amountValid =
    amountInput.trim() !== '' && !amountError && requestedAmount >= minPayout && requestedAmount <= balance;

  // Scroll target for the "Add a payout method first" gate — a disabled CTA
  // with the fix 600px below it is still a dead end.
  const scrollRef = useRef<ScrollView>(null);
  const methodSectionY = useRef(0);
  const scrollToMethod = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    scrollRef.current?.scrollTo({ y: Math.max(0, methodSectionY.current - 12), animated: true });
  }, []);

  // Pull the runner's recent payout history so they can see whether a
  // request is still pending before tapping "Request Payout" again.
  // Without this, runners frequently double-submit and then panic.
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const payoutsQ = useQuery<WalletTransaction[]>(
    ['runner', 'payouts', userId],
    async () => {
      const res = await runnerService.getPayoutHistory({ page: 1, per_page: 5 });
      // /wallet/transactions is paginated — unwrap to a flat list.
      return (res.data?.data ?? res.data?.data?.data ?? []) as WalletTransaction[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );
  const recentPayouts = payoutsQ.data ?? [];
  // A payout is "in flight" when its status is explicitly pending.
  // Discourages double-submits without time-based heuristics.
  const pendingPayout = useMemo(
    () => recentPayouts.find((p) => (p.status ?? 'pending') === 'pending') ?? null,
    [recentPayouts],
  );
  // A failed / reversed payout re-credits the wallet server-side but said so
  // nowhere in the app: the runner kept waiting 1–3 days for money that had
  // already come back. Surface the LATEST attempt when it bounced.
  const bouncedPayout = useMemo(() => {
    const latest = recentPayouts[0];
    if (!latest) return null;
    const s = String(latest.status ?? 'pending');
    return s === 'failed' || s === 'reversed' ? latest : null;
  }, [recentPayouts]);

  // The full wallet ledger — commission debits, adjustments, tips, refunds and
  // late-settled earnings all move the balance and had no home in the runner
  // app (it only ever listed type='payout'). Same endpoint the customer wallet
  // uses; no server change needed.
  const activityQ = useQuery<WalletTransaction[]>(
    ['runner', 'wallet', 'activity', userId],
    async () => {
      const res = await paymentService.getWalletTransactions({
        page: 1,
        per_page: ACTIVITY_PREVIEW,
      });
      return (res.data?.data ?? []) as WalletTransaction[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );
  const activity = activityQ.data ?? [];

  // Bumped by every payout-method save/remove. A profile READ that started
  // before one (the mount refresh, a pull-to-refresh) answers with the old
  // method, so it must not overwrite the saved one when it lands after it.
  const profileWriteSeq = useRef(0);

  // wallet_balance in authStore can be stale if the runner completed jobs
  // elsewhere — refresh the withdrawable number on mount so they never act
  // on an outdated balance (under-withdraw or hit a server rejection). This
  // is the most trust-critical figure on the screen. The runner profile comes
  // with it: the payout method and payout_minimum both gate this screen.
  useEffect(() => {
    let cancelled = false;
    const seq = profileWriteSeq.current;
    (async () => {
      try {
        const [me, prof] = await Promise.allSettled([
          userService.getProfile(),
          runnerService.getRunnerProfile(),
        ]);
        if (cancelled) return;
        if (me.status === 'fulfilled' && me.value.data?.data) setUser(me.value.data.data);
        if (
          prof.status === 'fulfilled' &&
          prof.value.data?.data &&
          profileWriteSeq.current === seq
        ) {
          setRunnerProfile(prof.value.data.data);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const seq = profileWriteSeq.current;
    try {
      // Refresh BOTH the runner profile (for payout method fields) and
      // the user record (for the wallet_balance display), plus the
      // payout history + wallet ledger so newly-submitted requests and
      // fresh commission rows appear right away after pull-to-refresh.
      const [prof, prof2] = await Promise.all([
        runnerService.getRunnerProfile(),
        userService.getProfile(),
        payoutsQ.refresh(),
        activityQ.refresh(),
      ]);
      if (profileWriteSeq.current === seq) setRunnerProfile(prof.data.data);
      if (prof2.data?.data) setUser(prof2.data.data);
    } catch {}
    setRefreshing(false);
  }, [setRunnerProfile, setUser, payoutsQ, activityQ]);

  const startEditingMethod = () => {
    Haptics.selectionAsync().catch(() => {});
    methodFormTouched.current = false;
    setMethodDraft(draftFromMethod(method, runnerProfile, user?.full_name ?? ''));
    setMethodErrors({});
    setEditingMethod(true);
  };

  const cancelEditingMethod = () => {
    methodFormTouched.current = false;
    setMethodErrors({});
    setEditingMethod(false);
  };

  // PUT /runner/payout-method — one explicit method (GCash, Maya or a bank),
  // saved whole: the server clears the other channel's number, so there is
  // never a second saved account that staff could send to by mistake.
  const methodSaveLatch = useRef(false);
  const handleSaveMethod = async () => {
    if (methodSaveLatch.current) return;
    const errors = validatePayoutDestination(methodDraft, RUNNER_PAYOUT_CHANNELS);
    setMethodErrors(errors);
    if (Object.keys(errors).length > 0) {
      haptics.warning();
      return;
    }
    methodSaveLatch.current = true;
    setSaving(true);
    try {
      const res = await runnerService.savePayoutMethod(toPayoutDestinationPayload(methodDraft));
      profileWriteSeq.current += 1;
      if (res.data?.data) setRunnerProfile(res.data.data);
      methodFormTouched.current = false;
      setEditingMethod(false);
      haptics.success();
      toast.success(res.data?.message ?? 'Payout method saved.');
    } catch (err: any) {
      haptics.error();
      // A 422 names the field that's wrong; it now shows under that field.
      // Repeating Laravel's summary ("…(and 1 more error)") in a toast on top
      // of it only buried the inline message, so the toast is kept for
      // failures that have no field to point at (offline, 5xx, a refusal).
      const fieldErrors = payoutDestinationServerErrors(err);
      setMethodErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0) {
        toast.error(errorMessage(err, copy.profile.saveFailed));
      }
    } finally {
      setSaving(false);
      methodSaveLatch.current = false;
    }
  };

  const confirmRemoveMethod = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      const res = await runnerService.removePayoutMethod();
      profileWriteSeq.current += 1;
      if (res.data?.data) setRunnerProfile(res.data.data);
      methodFormTouched.current = false;
      setEditingMethod(false);
      setShowRemoveModal(false);
      toast.success(res.data?.message ?? 'Payout method removed.');
    } catch (err: any) {
      haptics.error();
      toast.error(errorMessage(err, copy.profile.saveFailed));
    } finally {
      setRemoving(false);
    }
  };

  const handleRequestPayout = () => {
    // Client-side mirror of RunnerPayoutController's PAYOUT_METHOD_REQUIRED
    // gate. The server stays the authority — this just means the runner isn't
    // told only after typing an amount and confirming a modal.
    if (!method.ready) {
      haptics.warning();
      scrollToMethod();
      return;
    }
    if (requestedAmount < minPayout) {
      haptics.warning();
      toast.error(`The minimum payout is ${formatCurrency(minPayout)}. Enter at least that amount.`);
      return;
    }
    if (requestedAmount > balance) {
      haptics.warning();
      toast.error(`That's more than your available balance of ${formatCurrency(Math.max(0, balance))}. Lower the amount and try again.`);
      return;
    }
    setShowRequestModal(true);
  };

  // Synchronous latch closes the double-tap window before `requesting` state
  // lands. The idempotency key persists across retries of the SAME payout so a
  // network retry can never file two withdrawals; it's cleared only on success.
  const confirmLatch = useRef(false);
  const payoutKeyRef = useRef<string | null>(null);

  const confirmRequestPayout = async () => {
    if (confirmLatch.current) return;
    confirmLatch.current = true;
    if (!payoutKeyRef.current) payoutKeyRef.current = newIdempotencyKey();
    setRequesting(true);
    try {
      const res = await runnerService.requestPayout(requestedAmount, {
        idempotencyKey: payoutKeyRef.current,
      });
      // Success → this payout is filed; a fresh withdrawal needs a fresh key.
      payoutKeyRef.current = null;
      setShowRequestModal(false);
      setAmountInput('');
      // SuccessCheck fires its own success haptic on mount. The backend's
      // detailed confirmation (amount + destination + ETA) is the reassurance
      // line on the success screen, so it isn't repeated in a toast.
      setPayoutSuccess({
        amount: requestedAmount,
        to: method.label ?? null,
        message: typeof res?.data?.message === 'string' ? res.data.message : null,
      });
      await onRefresh();
    } catch (err: any) {
      // Keep the key so a retry of THIS payout dedupes server-side. Copy is
      // honest per code (insufficient balance / below minimum / no method).
      haptics.error();
      toast.error(errorMessage(err, copy.wallet.payoutFailed));
    } finally {
      setRequesting(false);
      confirmLatch.current = false;
    }
  };

  // Why the Request button can't be pressed — said under it, so a greyed-out
  // CTA is never a mystery (pattern 9). Empty when the inline amount error
  // already says it, or when nothing blocks the button.
  const requestBlockedReason = pendingPayout
    ? 'You can request another once this one is paid out.'
    : !method.ready
      ? 'Add a payout method below first.'
      : owesCommission
        ? 'Your balance is below zero from cash errands, so there’s nothing to withdraw yet.'
        : balance <= 0
          ? 'Nothing to withdraw yet. Earnings from paid-online errands land here.'
          : amountError
            ? ''
            : amountInput.trim() === '' || requestedAmount <= 0
              ? 'Enter an amount to withdraw.'
              : '';

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Payouts" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          paddingBottom: 24 + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Balance Card — brand blue gradient balance summary, matching
            the earnings hero and wallet cards. */}
        <View className="px-5 mb-4">
          <LinearGradient
            colors={[
              LightColors.gradientStart,
              LightColors.gradientMid,
              LightColors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 24, padding: 24, ...Elevation.md }}
          >
            <View className="flex-row items-center mb-2">
              <View className="w-9 h-9 rounded-full bg-white/20 items-center justify-center mr-2.5">
                <Wallet size={18} color={LightColors.textInverse} />
              </View>
              <Text className="text-xs font-montserrat-semi text-white/90 uppercase tracking-wider">
                Available for payout
              </Text>
            </View>
            <Text
              className="text-4xl font-inter-semi tabular-nums text-white"
              style={{ fontVariant: ['tabular-nums'] }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {owesCommission ? '−' : ''}
              {formatCurrency(Math.abs(balance))}
            </Text>
            {owesCommission ? (
              <Text className="text-[12px] leading-[17px] font-montserrat text-white/90 mt-1.5">
                {cashDebtText(balance, runnerProfile)}
              </Text>
            ) : belowMinimum ? (
              // Progress toward the payout minimum — reuses the daily-goal
              // bar's visual language (white fill on a translucent-white
              // track) so the runner sees momentum instead of a locked door.
              <View className="mt-3">
                <Text className="text-[12px] font-inter-semi text-white/90 tabular-nums mb-1.5">
                  {pesos(balance)} of {pesos(minPayout, Math.ceil)} needed to cash out
                </Text>
                <View
                  className="overflow-hidden"
                  accessibilityRole="progressbar"
                  accessibilityLabel={`${pesos(balance)} of ${pesos(minPayout, Math.ceil)} needed to cash out`}
                  accessibilityValue={{ min: 0, max: minPayout, now: Math.floor(balance) }}
                  style={{
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: 'rgba(255,255,255,0.22)',
                  }}
                >
                  <View
                    style={{
                      height: 6,
                      borderRadius: 999,
                      width: `${payoutProgress * 100}%`,
                      backgroundColor: LightColors.textInverse,
                    }}
                  />
                </View>
              </View>
            ) : (
              <Text className="text-[12px] font-montserrat tabular-nums text-white/90 mt-1">
                Withdraw anytime · Min {formatCurrency(minPayout)}
              </Text>
            )}
          </LinearGradient>
        </View>

        {/* Pending payout banner — if a payout request is still being
            processed, surface it prominently and disable the request
            button so the runner can't accidentally double-submit. */}
        {pendingPayout && (
          <View className="px-5 mb-4">
            <Card padding="none" className="flex-row items-center gap-3 p-3" style={{ backgroundColor: LightColors.warningLight }}>
              <Clock size={18} color={LightColors.warning} />
              <View className="flex-1">
                <Text className="text-sm font-montserrat-semi text-warningDark">
                  Payout in progress
                </Text>
                <Text className="text-xs font-montserrat mt-0.5 text-textSecondary">
                  {formatCurrency(Math.abs(Number(pendingPayout.amount ?? 0)))} · submitted{' '}
                  {formatMonthDay(pendingPayout.created_at)}.
                </Text>
              </View>
            </Card>
          </View>
        )}

        {/* Bounced payout — a failed/reversed payout re-credits the wallet
            server-side but told the runner nothing, so they kept waiting for
            money that had already come back. State it plainly, with the
            reason when the operator/gateway gave one. */}
        {bouncedPayout && !pendingPayout && (
          <View className="px-5 mb-4">
            <Card padding="none" className="flex-row items-start gap-3 p-3" style={{ backgroundColor: LightColors.dangerSoft }}>
              <AlertTriangle size={18} color={LightColors.danger} style={{ marginTop: 1 }} />
              <View className="flex-1">
                <Text className="text-sm font-montserrat-semi text-dangerDark">
                  {String(bouncedPayout.status) === 'reversed'
                    ? 'Your last payout was returned'
                    : 'Your last payout didn’t go through'}
                </Text>
                <Text className="text-xs font-montserrat mt-0.5 text-textSecondary">
                  {formatCurrency(Math.abs(Number(bouncedPayout.amount ?? 0)))} is back in your
                  balance — you can request it again.
                  {bouncedPayout.failure_reason ? ` Reason: ${bouncedPayout.failure_reason}` : ''}
                </Text>
              </View>
            </Card>
          </View>
        )}

        {/* Payout-method gate — the server rejects a payout with no usable
            method (PAYOUT_METHOD_REQUIRED), and it used to do so only AFTER
            the runner typed an amount, tapped Request and confirmed a modal.
            Say it up front, and make the fix one tap away instead of a scroll
            hunt. */}
        {!method.ready && (
          <View className="px-5 mb-4">
            <Card tone="tinted" className="p-4">
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {method.blocker === 'incomplete_bank'
                  ? `Finish your ${method.bankName} payout details`
                  : 'Add a payout method first'}
              </Text>
              <Text className="text-xs font-montserrat text-textSecondary mt-1 mb-3">
                {method.blocker === 'incomplete_bank'
                  ? 'We can’t see an account number saved for it. Enter your account number below and save — then you can request a payout.'
                  : 'Choose GCash, Maya or a bank account below so we know where to send your money.'}
              </Text>
              <Button
                title={
                  method.blocker === 'incomplete_bank'
                    ? 'Add account number'
                    : 'Add payout method'
                }
                variant="primary"
                trailingIcon={ChevronRight}
                onPress={scrollToMethod}
                fullWidth
              />
            </Card>
          </View>
        )}

        {/* Amount input + Request Payout */}
        <View className="px-5 mb-6">
          {/* A field label, not a section eyebrow — sentence case. */}
          <Text className="text-[13px] font-montserrat-semi text-textSecondary mb-2">
            Amount to withdraw
          </Text>
          {/* Persistent ₱ prefix keeps the peso context visible once the
              runner starts typing (the placeholder alone vanishes). Raw
              numeric state is unchanged for parsing. */}
          <View
            className={`flex-row items-center bg-surface border rounded-xl px-3 mb-2 ${
              amountError ? 'border-danger' : 'border-divider'
            }`}
            style={{ borderWidth: 1.5 }}
          >
            <Text className="text-lg font-inter-semi text-textSecondary mr-1">₱</Text>
            <TextInput
              className="flex-1 py-3 text-lg font-inter-semi tabular-nums text-textPrimary"
              style={{ minHeight: 52, fontVariant: ['tabular-nums'] }}
              placeholder="0.00"
              placeholderTextColor={LightColors.textMuted}
              value={amountInput}
              onChangeText={(v) => setAmountInput(sanitizeAmount(v))}
              keyboardType="decimal-pad"
              accessibilityLabel="Amount to withdraw"
            />
            {amountValid ? (
              // Decorative: the enabled Request button says the same to a
              // screen reader.
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="w-6 h-6 rounded-full bg-successLight items-center justify-center ml-2"
                testID="payout-amount-valid"
              >
                <Check size={14} color={LightColors.successDark} strokeWidth={2.6} />
              </View>
            ) : null}
          </View>
          {amountError && (
            <View className="flex-row items-start mb-2">
              <AlertCircle
                size={14}
                color={LightColors.dangerDark}
                strokeWidth={2.2}
                style={{ marginTop: 2, marginRight: 6 }}
              />
              <Text
                className="flex-1 text-[13px] leading-[18px] font-montserrat-semi text-dangerDark"
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
              >
                {amountError}
              </Text>
            </View>
          )}
          <View className="flex-row items-center justify-between mb-3">
            <Text className="flex-1 text-[12px] font-montserrat tabular-nums text-textSecondary mr-3">
              Min {formatCurrency(minPayout)}
              {method.label ? ` · to ${method.label}` : ''}
            </Text>
            {balance > 0 && (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setAmountInput(String(balance));
                }}
                // Text link is ~16pt tall — hitSlop lifts the effective
                // target to >=44pt.
                hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
                accessibilityRole="button"
                accessibilityLabel="Set amount to maximum available"
              >
                <Text className="text-[13px] font-montserrat-bold text-primary">
                  Withdraw all
                </Text>
              </Pressable>
            )}
          </View>
          <Button
            title={pendingPayout ? 'Payout in progress' : 'Request payout'}
            size="lg"
            onPress={handleRequestPayout}
            loading={requesting}
            loadingTitle="Requesting…"
            // `!method.ready` mirrors the server's PAYOUT_METHOD_REQUIRED gate;
            // the tinted card above it carries the one-tap fix, so a disabled
            // CTA here is a signpost, not a dead end.
            disabled={
              !method.ready ||
              !!pendingPayout ||
              balance <= 0 ||
              requestedAmount < minPayout ||
              requestedAmount > balance
            }
            disabledReason={requestBlockedReason}
            fullWidth
          />
          <Text className="text-[12px] font-montserrat text-textSecondary text-center mt-2">
            Payouts usually arrive within 1–3 business days.
          </Text>
        </View>

        {/* Recent Payouts — last 5 payout requests with real status
            badges (pending / completed / failed) so the runner has an
            accurate audit trail without leaving the screen. */}
        <View className="px-5 mb-6">
          <Text className="text-xs font-montserrat-bold text-textSecondary uppercase tracking-wider mb-2">
            Recent payouts
          </Text>
          {payoutsQ.loading && recentPayouts.length === 0 ? (
            // First-load skeleton — mirrors the payout row shape.
            <Card padding="none" className="overflow-hidden">
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  className={`flex-row items-center px-4 py-3 ${i < 3 ? 'border-b border-divider' : ''}`}
                >
                  <Skeleton width={18} height={18} borderRadius={9} />
                  <View className="flex-1 ml-3">
                    <Skeleton width="35%" height={14} style={{ marginBottom: 6 }} />
                    <Skeleton width="55%" height={10} />
                  </View>
                  <Skeleton width={52} height={18} borderRadius={9} />
                </View>
              ))}
            </Card>
          ) : payoutsQ.error && recentPayouts.length === 0 ? (
            <Card className="px-4 py-3">
              <ErrorState
                error={payoutsQ.error}
                compact
                title="Couldn't load payouts"
                onRetry={() => payoutsQ.refresh()}
              />
            </Card>
          ) : recentPayouts.length === 0 ? (
            <Card padding="none">
              <RunnerEmptyState
                title="No payouts yet"
                description={`Request your first payout once you've earned ${formatCurrency(minPayout)}.`}
              />
            </Card>
          ) : (
            <Card padding="none" className="overflow-hidden">
              {recentPayouts.map((tx, idx) => {
                // Read as a plain string: the server also writes 'reversed'
                // (WalletService::reversePayout, Xendit payout.reversed) which
                // the mobile status union doesn't declare. It used to fall into
                // the else branch and render as "Pending / Processing — usually
                // 1–3 business days" FOREVER, for money already back in the
                // runner's balance.
                const status = String(tx.status ?? 'pending');
                const isPending = status === 'pending';
                const StatusIcon =
                  status === 'completed'
                    ? CheckCircle2
                    : status === 'failed'
                      ? XCircle
                      : status === 'reversed'
                        ? RotateCcw
                        : Clock;
                const statusColor =
                  status === 'completed'
                    ? LightColors.success
                    : status === 'failed'
                      ? LightColors.danger
                      : status === 'reversed'
                        ? LightColors.primary
                        : LightColors.warning;
                // Base tones fail AA at these <17px sizes — the *Dark rung
                // is for status TEXT; base tones stay on glyphs/dots/fills.
                const statusTextColor =
                  status === 'completed'
                    ? LightColors.successDark
                    : status === 'failed'
                      ? LightColors.dangerDark
                      : status === 'reversed'
                        ? LightColors.primaryDark
                        : LightColors.warningDark;
                const statusLabel =
                  status === 'completed'
                    ? 'Paid'
                    : status === 'failed'
                      ? 'Failed'
                      : status === 'reversed'
                        ? 'Returned'
                        : 'Pending';
                return (
                  <View
                    key={tx.id}
                    className={`flex-row items-start px-4 py-3 ${
                      idx < recentPayouts.length - 1 ? 'border-b border-divider' : ''
                    }`}
                  >
                    <StatusIcon size={20} color={statusColor} style={{ marginTop: 1 }} />
                    <View className="flex-1 ml-3">
                      <Text
                        className="text-[15px] font-inter-semi tabular-nums text-textPrimary"
                        style={{ fontVariant: ['tabular-nums'] }}
                        accessibilityLabel={`${formatCurrency(Math.abs(Number(tx.amount ?? 0)))}, ${statusLabel}`}
                      >
                        {formatCurrency(Math.abs(Number(tx.amount ?? 0)))}
                      </Text>
                      {/* Two-step processing timeline — Requested →
                          Paid/Failed. Mirrors StatusTimeline's dot +
                          connector language at row scale. */}
                      <View className="mt-1.5">
                        <View className="flex-row items-center">
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: LightColors.success,
                            }}
                          />
                          <Text className="text-xs font-montserrat text-textSecondary ml-2">
                            Requested · {fmtPayoutDate(tx.created_at)}
                          </Text>
                        </View>
                        <View
                          style={{
                            width: 2,
                            height: 8,
                            marginLeft: 3,
                            marginVertical: 1,
                            borderRadius: 1,
                            backgroundColor: isPending
                              ? LightColors.dividerStrong
                              : statusColor,
                          }}
                        />
                        <View className="flex-row items-center">
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: isPending ? 'transparent' : statusColor,
                              borderWidth: isPending ? 1.5 : 0,
                              borderColor: LightColors.dividerStrong,
                            }}
                          />
                          <Text
                            className={`text-xs ml-2 flex-1 ${
                              isPending
                                ? 'font-montserrat text-textSecondary'
                                : 'font-montserrat-semi'
                            }`}
                            style={isPending ? undefined : { color: statusTextColor }}
                          >
                            {status === 'completed'
                              ? `Paid · ${fmtPayoutDate(tx.processed_at) || 'processed'}`
                              : status === 'failed'
                                ? `Didn’t go through · back in your balance`
                                : status === 'reversed'
                                  ? 'Returned to your balance'
                                  : 'Processing — usually 1–3 business days'}
                          </Text>
                        </View>
                      </View>
                      {(status === 'failed' || status === 'reversed') && tx.failure_reason && (
                        <Text className="text-xs font-montserrat text-textSecondary mt-1" numberOfLines={2}>
                          {tx.failure_reason}
                        </Text>
                      )}
                    </View>
{/* No status pill: the timeline line already says Paid / Pending /
                        Returned, and a pill only repeated it. */}
                  </View>
                );
              })}
            </Card>
          )}
        </View>

        {/* Wallet activity — the full ledger, not just payouts. Cash-errand
            commission debits, admin adjustments, failed-payout re-credits,
            tips and late-settled earnings all move this balance and had
            nowhere to be seen in the runner app. */}
        <View className="px-5 mb-6">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-montserrat-bold text-textSecondary uppercase tracking-wider">
              Wallet activity
            </Text>
            {activity.length > 0 && (
              <Pressable
                onPress={() => router.push('/(runner)/payout/activity' as any)}
                hitSlop={{ top: 15, bottom: 15, left: 16, right: 16 }}
                accessibilityRole="button"
                accessibilityLabel="See all wallet activity"
              >
                <Text className="text-[13px] font-montserrat-bold text-primary">See all</Text>
              </Pressable>
            )}
          </View>
          {activityQ.loading && activity.length === 0 ? (
            <Card padding="none" className="overflow-hidden">
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  className={`flex-row items-center px-4 py-3 ${i < 3 ? 'border-b border-divider' : ''}`}
                >
                  <Skeleton width={36} height={36} borderRadius={18} />
                  <View className="flex-1 ml-3">
                    <Skeleton width="60%" height={13} style={{ marginBottom: 6 }} />
                    <Skeleton width="30%" height={10} />
                  </View>
                  <Skeleton width={60} height={14} />
                </View>
              ))}
            </Card>
          ) : activityQ.error && activity.length === 0 ? (
            <Card className="px-4 py-3">
              <ErrorState
                error={activityQ.error}
                compact
                title="Couldn't load your wallet activity"
                onRetry={() => activityQ.refresh()}
              />
            </Card>
          ) : activity.length === 0 ? (
            <Card padding="none">
              <RunnerEmptyState
                title="No wallet activity yet"
                description="Earnings, tips, platform fees and payouts will all show up here."
              />
            </Card>
          ) : (
            <Card padding="none" className="overflow-hidden">
              {activity.map((tx, idx) => (
                <WalletActivityRow
                  key={tx.id}
                  tx={tx}
                  divider={idx < activity.length - 1}
                />
              ))}
            </Card>
          )}
        </View>

        {/* Payout method — ONE explicit destination (GCash, Maya or a bank),
            shown as the place the money will actually go. The form only
            appears when nothing usable is saved, or after "Change". */}
        <View
          className="px-5 mb-4"
          onLayout={(e) => {
            methodSectionY.current = e.nativeEvent.layout.y;
          }}
        >
          <Text className="text-xs font-montserrat-bold text-textSecondary uppercase tracking-wider mb-2">
            Payout method
          </Text>
          <Card className="p-4">
            {!showMethodForm ? (
              <>
                <View className="flex-row items-center">
                  {method.channel === 'gcash' || method.channel === 'maya' ? (
                    <PaymentBrandMark type={method.channel} size={40} />
                  ) : (
                    <View className="w-10 h-10 rounded-xl bg-surfaceMuted items-center justify-center">
                      {method.channel === 'bank' ? (
                        <Landmark size={18} color={LightColors.primary} strokeWidth={1.8} />
                      ) : (
                        <Smartphone size={18} color={LightColors.primary} strokeWidth={1.8} />
                      )}
                    </View>
                  )}
                  <View className="flex-1 ml-3">
                    <Text className="text-[12px] font-montserrat text-textSecondary">
                      Payouts go to
                    </Text>
                    <Text className="text-sm font-montserrat-bold text-textPrimary">
                      {method.label}
                    </Text>
                    {method.accountName ? (
                      <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
                        {method.accountName}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {/* Saved by an older app version, which never asked which
                    e-wallet the number belongs to. */}
                {method.needsChannel ? (
                  <Text className="text-[12px] font-montserrat-semi text-warningDark mt-3">
                    Is this number GCash or Maya? Update it so your payouts go the right way.
                  </Text>
                ) : null}
                <View className="flex-row mt-4" style={{ gap: 12 }}>
                  <Button
                    title={method.needsChannel ? 'Update' : 'Change'}
                    variant="outline"
                    onPress={startEditingMethod}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Remove"
                    variant="ghost"
                    onPress={() => setShowRemoveModal(true)}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            ) : (
              <>
                <Text className="text-xs font-montserrat text-textSecondary mb-3">
                  {method.ready
                    ? 'Choose where your payouts should go instead. Payouts you already requested keep their destination.'
                    : 'Where should we send your payouts?'}
                </Text>
                <PayoutDestinationForm
                  value={methodDraft}
                  onChange={(next) => {
                    methodFormTouched.current = true;
                    setMethodDraft(next);
                    setMethodErrors({});
                  }}
                  channels={RUNNER_PAYOUT_CHANNELS}
                  errors={methodErrors}
                />
                <Button
                  title="Save payout method"
                  onPress={handleSaveMethod}
                  loading={saving}
                  loadingTitle="Saving…"
                  disabled={!methodDraft.channel}
                  disabledReason="Choose GCash, Maya or a bank account first."
                  fullWidth
                />
                {method.ready ? (
                  <Button title="Cancel" variant="ghost" onPress={cancelEditingMethod} fullWidth />
                ) : null}
              </>
            )}
          </Card>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Success moment (pattern 10) — the big check, what was requested and
          where it goes, when to expect it, then one way on. */}
      {payoutSuccess && (
        <View
          className="absolute inset-0 items-center justify-center px-6"
          style={{ backgroundColor: `${LightColors.ink}80`, zIndex: 50 }}
          accessibilityViewIsModal
        >
          <View
            className="bg-surface items-center w-full px-6 pt-8 pb-6"
            style={{ borderRadius: 24, maxWidth: 380, ...Elevation.lg }}
          >
            <SuccessCheck size={84} />
            <Text
              className="text-[20px] font-montserrat-bold text-textPrimary mt-5 text-center"
              accessibilityRole="header"
            >
              Payout requested
            </Text>
            <Text
              className="text-[32px] font-inter-semi tabular-nums text-textPrimary mt-2"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCurrency(payoutSuccess.amount)}
            </Text>
            {payoutSuccess.to ? (
              <Text className="text-[14px] font-montserrat text-textSecondary mt-1 text-center">
                to {payoutSuccess.to}
              </Text>
            ) : null}
            <Text className="text-[13px] leading-[19px] font-montserrat text-textSecondary mt-4 text-center">
              {payoutSuccess.message ??
                'It usually arrives within 1–3 business days. We’ll let you know when it’s paid out.'}
            </Text>
            <View className="w-full mt-6">
              <Button title="Done" size="lg" fullWidth onPress={() => setPayoutSuccess(null)} />
            </View>
          </View>
        </View>
      )}

      <ConfirmModal
        visible={showRequestModal}
        title="Request payout?"
        // Name the destination the money will ACTUALLY go to — the saved
        // method, exactly as the server will record it on the payout.
        message={`Submit a payout request for ${formatCurrency(requestedAmount)}? Funds will be transferred to ${
          method.label ?? 'your saved account'
        } within 1–3 business days.`}
        confirmLabel="Request"
        confirmLoadingLabel="Requesting…"
        cancelLabel="Cancel"
        loading={requesting}
        onConfirm={confirmRequestPayout}
        onCancel={() => setShowRequestModal(false)}
      />

      <ConfirmModal
        visible={showRemoveModal}
        title="Remove payout method?"
        message={`You’ll need to add one again before you can request a payout. Payouts you already requested still go to ${
          method.label ?? 'the account they were requested to'
        }.`}
        confirmLabel="Remove"
        confirmLoadingLabel="Removing…"
        cancelLabel="Keep it"
        destructive
        loading={removing}
        onConfirm={confirmRemoveMethod}
        onCancel={() => setShowRemoveModal(false)}
      />
    </View>
  );
}
