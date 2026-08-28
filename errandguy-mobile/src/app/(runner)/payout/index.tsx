import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  Wallet,
  CreditCard,
  Smartphone,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertTriangle,
  Check,
  ChevronRight,
} from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { Skeleton } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';
import { RunnerEmptyState } from '../../../components/ui/RunnerEmptyState';
import { Illustration } from '../../../components/ui/Illustration';
import { SuccessCheck } from '../../../components/ui/SuccessCheck';
import { WalletActivityRow } from '../../../components/runner/WalletActivityRow';
import {
  PH_BANKS,
  OTHER_BANK,
  isKnownBank,
  maskedAccount,
  payoutMinimum,
  resolvePayoutMethod,
  type SelfRunnerProfile,
} from '../../../components/runner/payoutMethod';
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
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { haptics } from '../../../utils/haptics';
import { Radius } from '../../../constants/radius';
import type { WalletTransaction } from '../../../types';
import { LightColors, Elevation } from '../../../constants/colors';

/** How many ledger rows the inline "Wallet activity" preview shows. */
const ACTIVITY_PREVIEW = 6;

/** Whole-peso display for the payout-progress line — "₱65 of ₱100".
 *  Mirrors the runner home daily-goal bar's peso formatting so the two
 *  progress surfaces read as one visual family. */
const pesos = (v: number) => `₱${Math.round(v).toLocaleString('en-PH')}`;

function fmtPayoutDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  // RunnerPayoutController so the runner is told before they submit.
  const method = useMemo(() => resolvePayoutMethod(runnerProfile), [runnerProfile]);

  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  // Bank name is a picker, not free text — typos used to route real payouts
  // into manual admin fixes. `OTHER_BANK` reveals the one typed escape hatch.
  const [bankChoice, setBankChoice] = useState<string>(() =>
    !runnerProfile?.bank_name
      ? ''
      : isKnownBank(runnerProfile.bank_name)
        ? (PH_BANKS.find(
            (b) => b.toLowerCase() === runnerProfile.bank_name!.trim().toLowerCase(),
          ) as string)
        : OTHER_BANK,
  );
  const [customBank, setCustomBank] = useState(() =>
    runnerProfile?.bank_name && !isKnownBank(runnerProfile.bank_name)
      ? runnerProfile.bank_name
      : '',
  );
  const [bankAccount, setBankAccount] = useState('');
  const [ewalletNumber, setEwalletNumber] = useState(runnerProfile?.ewallet_number ?? '');
  const [saving, setSaving] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  // Brief SuccessCheck overlay after a payout request is accepted.
  const [showPayoutSuccess, setShowPayoutSuccess] = useState(false);

  const resolvedBankName =
    bankChoice === OTHER_BANK ? customBank.trim() : bankChoice.trim();

  // Once the runner starts editing the method form, a background profile
  // refresh (the mount fetch, or the one after a save) must not overwrite what
  // they typed. Cleared after a successful save so the canonical server values
  // flow back in.
  const methodFormTouched = useRef(false);
  const touchMethodForm = useCallback(() => {
    methodFormTouched.current = true;
  }, []);

  const requestedAmount = parseFloat(amountInput) || 0;

  // Reason the Request button is blocked, surfaced inline so a disabled
  // button is recoverable instead of a dead end. Only shown once the
  // runner has actually typed something invalid.
  const amountError =
    amountInput.trim() === ''
      ? null
      : requestedAmount > 0 && requestedAmount < minPayout
      ? `Enter at least ${formatCurrency(minPayout)}`
      : requestedAmount > balance
      ? `Amount exceeds your ${formatCurrency(Math.max(0, balance))} available`
      : null;

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

  useEffect(() => {
    if (runnerProfile && !methodFormTouched.current) {
      const saved = runnerProfile.bank_name ?? '';
      setBankChoice(
        !saved
          ? ''
          : isKnownBank(saved)
            ? ((PH_BANKS.find((b) => b.toLowerCase() === saved.trim().toLowerCase()) ??
                OTHER_BANK) as string)
            : OTHER_BANK,
      );
      setCustomBank(saved && !isKnownBank(saved) ? saved : '');
      // Do NOT reset the account number from the profile: it's write-only —
      // encrypted at rest + $hidden, so the API never returns the number
      // itself. Prefilling from the (always-undefined) field cleared what the
      // runner typed and, after a save+refetch, reset it to '' as if only the
      // account number failed. `bank_account_last4` now proves an account IS
      // on file without ever putting digits back in the input.
      setEwalletNumber(runnerProfile.ewallet_number ?? '');
    }
  }, [runnerProfile]);

  // wallet_balance in authStore can be stale if the runner completed jobs
  // elsewhere — refresh the withdrawable number on mount so they never act
  // on an outdated balance (under-withdraw or hit a server rejection). This
  // is the most trust-critical figure on the screen. The runner profile comes
  // with it: bank_account_last4 and payout_minimum both gate this screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, prof] = await Promise.allSettled([
          userService.getProfile(),
          runnerService.getRunnerProfile(),
        ]);
        if (cancelled) return;
        if (me.status === 'fulfilled' && me.value.data?.data) setUser(me.value.data.data);
        if (prof.status === 'fulfilled' && prof.value.data?.data) {
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
      setRunnerProfile(prof.data.data);
      if (prof2.data?.data) setUser(prof2.data.data);
    } catch {}
    setRefreshing(false);
  }, [setRunnerProfile, setUser, payoutsQ, activityQ]);

  const handleSavePayoutInfo = async () => {
    if (bankChoice === OTHER_BANK && !customBank.trim()) {
      haptics.warning();
      toast.error('Type your bank’s name, or pick one from the list.');
      return;
    }
    setSaving(true);
    try {
      // Previously skipped ewallet_number, so the field on screen was
      // purely decorative. Send it now so payouts can route to GCash/Maya.
      await runnerService.updateRunnerProfile({
        bank_name: resolvedBankName || undefined,
        bank_account_number: bankAccount.trim() || undefined,
        ewallet_number: ewalletNumber.trim() || undefined,
      });
      setBankAccount('');
      // Saved → let the canonical server values (including the fresh
      // bank_account_last4) flow back into the form again.
      methodFormTouched.current = false;
      toast.success('Payout information updated');
      await onRefresh();
      // Mirror the server's own rule out loud: a bank needs BOTH the name and
      // an account number. Saving just the bank name looks like progress but
      // leaves the payout unsendable, which is exactly how runners ended up
      // rejected at request time.
      const saved = resolvePayoutMethod(
        useRunnerStore.getState().runnerProfile as SelfRunnerProfile | null,
      );
      if (!saved.ready && saved.blocker === 'incomplete_bank') {
        toast.info('Add your account number too — we can’t send a bank payout without it.');
      }
    } catch (err: any) {
      haptics.error();
      toast.error(errorMessage(err, copy.profile.saveFailed));
    } finally {
      setSaving(false);
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
      // SuccessCheck fires its own success haptic on mount.
      setShowPayoutSuccess(true);
      // Prefer the backend's detailed confirmation (amount + destination + ETA)
      // over a bare "submitted" — falls back to the copy catalog.
      toast.success(res?.data?.message ?? copy.wallet.payoutRequested);
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
              <View className="w-9 h-9 rounded-full bg-white/15 items-center justify-center mr-2.5">
                <Wallet size={18} color={LightColors.textInverse} />
              </View>
              <Text className="text-xs font-montserrat-semi text-white/70 uppercase tracking-wider">
                Available for payout
              </Text>
            </View>
            <Text
              className="text-4xl font-inter-semi tabular-nums text-white"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {owesCommission ? '−' : ''}
              {formatCurrency(Math.abs(balance))}
            </Text>
            {owesCommission ? (
              <Text className="text-[11px] font-montserrat text-white/85 mt-1.5">
                You owe {formatCurrency(Math.abs(balance))} in platform fees from cash errands.
                It’s settled automatically from your next online earnings — nothing to pay
                separately.
              </Text>
            ) : belowMinimum ? (
              // Progress toward the payout minimum — reuses the daily-goal
              // bar's visual language (white fill on a translucent-white
              // track) so the runner sees momentum instead of a locked door.
              <View className="mt-3">
                <Text className="text-[11px] font-inter-semi text-white/90 tabular-nums mb-1.5">
                  {pesos(balance)} of {pesos(minPayout)} to your first payout
                </Text>
                <View
                  className="overflow-hidden"
                  accessibilityRole="progressbar"
                  accessibilityLabel={`${pesos(balance)} of ${pesos(minPayout)} toward your first payout`}
                  accessibilityValue={{ min: 0, max: minPayout, now: Math.round(balance) }}
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
              <Text className="text-[11px] font-montserrat text-white/70 mt-1">
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
            <Card className="flex-row items-center gap-3 p-3 bg-warningLight">
              <Clock size={18} color={LightColors.warning} />
              <View className="flex-1">
                <Text className="text-sm font-montserrat-semi text-warningDark">
                  Payout in progress
                </Text>
                <Text className="text-xs font-montserrat mt-0.5 text-textSecondary">
                  {formatCurrency(Math.abs(Number(pendingPayout.amount ?? 0)))} · submitted{' '}
                  {new Date(pendingPayout.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}.
                  You can request another after this one is paid out.
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
            <Card className="flex-row items-start gap-3 p-3 bg-dangerSoft">
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
                  : 'Save a bank account or an e-wallet number below so we know where to send your money.'}
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
          <Text className="text-xs font-montserrat-bold text-textSecondary uppercase tracking-wider mb-2">
            Amount to withdraw
          </Text>
          {/* Persistent ₱ prefix keeps the peso context visible once the
              runner starts typing (the placeholder alone vanishes). Raw
              numeric state is unchanged for parsing. */}
          <View
            className={`flex-row items-center bg-surface border rounded-lg px-3 mb-2 ${
              amountError ? 'border-danger' : 'border-divider'
            }`}
          >
            <Text className="text-base font-inter-semi text-textSecondary mr-1">₱</Text>
            <TextInput
              className="flex-1 py-3 text-base font-inter-semi tabular-nums text-textPrimary"
              style={{ minHeight: 48 }}
              placeholder="0.00"
              placeholderTextColor={LightColors.textMuted}
              value={amountInput}
              onChangeText={(v) => setAmountInput(sanitizeAmount(v))}
              keyboardType="decimal-pad"
              accessibilityLabel="Amount to withdraw"
            />
          </View>
          {amountError && (
            <Text className="text-xs font-montserrat-semi text-dangerDark mb-2">
              {amountError}
            </Text>
          )}
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-[11px] font-montserrat text-textTertiary">
              Min {formatCurrency(minPayout)}
              {method.destination ? ` · to ${method.destination}` : ''}
            </Text>
            {balance > 0 && (
              <Pressable
                onPress={() => setAmountInput(String(balance))}
                // Text link is ~14pt tall — hitSlop lifts the effective
                // target to >=44pt.
                hitSlop={{ top: 15, bottom: 15, left: 16, right: 16 }}
                accessibilityRole="button"
                accessibilityLabel="Set amount to maximum available"
              >
                <Text className="text-[11px] font-montserrat-semi text-primary">
                  Withdraw all
                </Text>
              </Pressable>
            )}
          </View>
          <Button
            title={pendingPayout ? 'Payout in progress' : 'Request Payout'}
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
            fullWidth
          />
          <Text className="text-[11px] font-montserrat text-textTertiary text-center mt-2">
            Payouts usually arrive within 1–3 business days.
          </Text>
        </View>

        {/* Recent Payouts — last 5 payout requests with real status
            badges (pending / completed / failed) so the runner has an
            accurate audit trail without leaving the screen. */}
        <View className="px-5 mb-6">
          <Text className="text-xs font-montserrat-bold text-textSecondary uppercase tracking-wider mb-2">
            Recent Payouts
          </Text>
          {payoutsQ.loading && recentPayouts.length === 0 ? (
            // First-load skeleton — mirrors the payout row shape.
            <Card className="p-0 overflow-hidden">
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
                compact
                title="Couldn't load payouts"
                description="Check your connection and try again."
                onRetry={() => payoutsQ.refresh()}
              />
            </Card>
          ) : recentPayouts.length === 0 ? (
            <Card className="p-0">
              <RunnerEmptyState
                eyebrow="Payouts"
                title="No payouts yet"
                description={`Request your first payout once you've earned ${formatCurrency(minPayout)}.`}
              />
            </Card>
          ) : (
            <Card className="p-0 overflow-hidden">
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
                    <StatusIcon size={18} color={statusColor} style={{ marginTop: 1 }} />
                    <View className="flex-1 ml-3">
                      <Text className="text-sm font-inter-semi tabular-nums text-textPrimary">
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
                                ? 'font-montserrat text-textTertiary'
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
                    <View
                      className="px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: statusColor + '15' }}
                    >
                      <Text
                        className="text-[10px] font-montserrat-bold uppercase tracking-wider"
                        style={{ color: statusTextColor }}
                      >
                        {statusLabel}
                      </Text>
                    </View>
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
                <Text className="text-[11px] font-montserrat-semi text-primary">See all</Text>
              </Pressable>
            )}
          </View>
          {activityQ.loading && activity.length === 0 ? (
            <Card className="p-0 overflow-hidden">
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
                compact
                title="Couldn't load your wallet activity"
                description="Check your connection and try again."
                onRetry={() => activityQ.refresh()}
              />
            </Card>
          ) : activity.length === 0 ? (
            <Card className="p-0">
              <RunnerEmptyState
                eyebrow="Wallet"
                title="No wallet activity yet"
                description="Earnings, tips, platform fees and payouts will all show up here."
              />
            </Card>
          ) : (
            <Card className="p-0 overflow-hidden">
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

        {/* Bank Account */}
        <View
          className="px-5 mb-4"
          onLayout={(e) => {
            methodSectionY.current = e.nativeEvent.layout.y;
          }}
        >
          <Card className="p-4">
            <View className="flex-row items-center mb-3">
              <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
                <CreditCard size={18} color={LightColors.primary} strokeWidth={1.8} />
              </View>
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                Bank Account
              </Text>
            </View>
            <Text className="text-xs font-montserrat text-textSecondary mb-2">Bank</Text>
            {/* A picker, not free text: hand-typed bank names ("BDo",
                "metro bank") routed real payouts into manual admin fixes. */}
            <View
              className="flex-row flex-wrap gap-2 mb-3"
              accessibilityRole="radiogroup"
              accessibilityLabel="Bank"
            >
              {[...PH_BANKS, OTHER_BANK].map((bank) => {
                const selected = bankChoice === bank;
                return (
                  <Pressable
                    key={bank}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      touchMethodForm();
                      setBankChoice(selected ? '' : bank);
                    }}
                    android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
                    accessibilityRole="radio"
                    accessibilityLabel={bank}
                    accessibilityState={{ selected }}
                    // Layout stays in className — a Pressable styled only via
                    // style={() => [obj]} drops flexDirection/backgroundColor.
                    className="flex-row items-center px-3 py-2"
                    style={({ pressed }) => [
                      {
                        borderRadius: Radius.chip,
                        borderWidth: 1.5,
                        borderColor: selected ? LightColors.primary : LightColors.divider,
                        backgroundColor: selected
                          ? LightColors.primaryLight
                          : LightColors.surface,
                        overflow: 'hidden',
                        minHeight: 40,
                      },
                      pressed ? { opacity: 0.92 } : null,
                    ]}
                  >
                    {selected && (
                      <Check size={13} color={LightColors.primary} style={{ marginRight: 4 }} />
                    )}
                    <Text
                      className={`text-[13px] ${
                        selected ? 'font-montserrat-bold text-primary' : 'font-montserrat-semi text-textSecondary'
                      }`}
                    >
                      {bank}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {bankChoice === OTHER_BANK && (
              <TextInput
                className="bg-surface border border-divider rounded-lg px-3 py-3 text-sm font-montserrat text-textPrimary mb-3"
                style={{ minHeight: 48 }}
                placeholder="Type your bank's name"
                placeholderTextColor={LightColors.textMuted}
                value={customBank}
                onChangeText={(v) => {
                  touchMethodForm();
                  setCustomBank(v);
                }}
                autoCapitalize="words"
                accessibilityLabel="Bank name"
              />
            )}
            <Text className="text-xs font-montserrat text-textSecondary mb-1">Account Number</Text>
            <TextInput
              className="bg-surface border border-divider rounded-lg px-3 py-3 text-sm font-inter tabular-nums text-textPrimary"
              style={{ minHeight: 48 }}
              placeholder={
                method.bankLast4 ? 'Enter a new number to replace it' : 'Enter account number'
              }
              placeholderTextColor={LightColors.textMuted}
              value={bankAccount}
              onChangeText={(v) => {
                touchMethodForm();
                setBankAccount(v);
              }}
              keyboardType="number-pad"
              accessibilityLabel="Bank account number"
            />
            {/* The number itself is encrypted + $hidden, so the field is blank
                forever and runners re-entered it "just in case" every visit.
                The last 4 digits prove an account IS on file. */}
            {method.bankLast4 ? (
              <Text className="text-[11px] font-montserrat text-textTertiary mt-1.5">
                {maskedAccount(method.bankLast4)} on file · leave blank to keep it
              </Text>
            ) : bankChoice ? (
              <Text className="text-[11px] font-montserrat-semi text-warningDark mt-1.5">
                We can’t send a bank payout without an account number.
              </Text>
            ) : null}
          </Card>
        </View>

        {/* E-Wallet */}
        <View className="px-5 mb-4">
          <Card className="p-4">
            <View className="flex-row items-center mb-3">
              <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
                <Smartphone size={18} color={LightColors.primary} strokeWidth={1.8} />
              </View>
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                E-Wallet
              </Text>
            </View>
            <Text className="text-xs font-montserrat text-textSecondary mb-1">E-Wallet Number</Text>
            <TextInput
              className="bg-surface border border-divider rounded-lg px-3 py-3 text-sm font-inter tabular-nums text-textPrimary"
              style={{ minHeight: 48 }}
              placeholder="e.g. GCash, Maya number"
              placeholderTextColor={LightColors.textMuted}
              value={ewalletNumber}
              onChangeText={(v) => {
                touchMethodForm();
                setEwalletNumber(v);
              }}
              keyboardType="phone-pad"
              accessibilityLabel="E-wallet number"
            />
          </Card>
        </View>

        {/* Save */}
        <View className="px-5">
          <Button
            title="Save Payout Info"
            variant="outline"
            onPress={handleSavePayoutInfo}
            loading={saving}
            loadingTitle="Saving…"
            fullWidth
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Success moment — payout request accepted. SuccessCheck fires
          its own success haptic; onDone dismisses the overlay. */}
      {showPayoutSuccess && (
        <View
          className="absolute inset-0 items-center justify-center"
          style={{ backgroundColor: `${LightColors.ink}80`, zIndex: 50 }}
        >
          <Illustration
            name="runner-payout-success"
            size={180}
            style={{ marginBottom: 8 }}
          />
          <SuccessCheck onDone={() => setShowPayoutSuccess(false)} />
        </View>
      )}

      <ConfirmModal
        visible={showRequestModal}
        title="Request payout?"
        // Name the destination the money will ACTUALLY go to — the server
        // resolves ewallet_number before bank_account_number, so a runner with
        // both saved used to be promised "your saved account" and paid to the
        // e-wallet.
        message={`Submit a payout request for ${formatCurrency(requestedAmount)}? Funds will be transferred to ${
          method.destination ?? 'your saved account'
        } within 1–3 business days.`}
        confirmLabel="Request"
        confirmLoadingLabel="Requesting…"
        cancelLabel="Cancel"
        loading={requesting}
        onConfirm={confirmRequestPayout}
        onCancel={() => setShowRequestModal(false)}
      />
    </View>
  );
}
