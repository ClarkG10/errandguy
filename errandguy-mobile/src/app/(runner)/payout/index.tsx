import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Wallet, CreditCard, Smartphone, Clock, CheckCircle2, XCircle } from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { Skeleton } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';
import { RunnerEmptyState } from '../../../components/ui/RunnerEmptyState';
import { Illustration } from '../../../components/ui/Illustration';
import { SuccessCheck } from '../../../components/ui/SuccessCheck';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { userService } from '../../../services/user.service';
import { runnerService } from '../../../services/runner.service';
import { newIdempotencyKey } from '../../../utils/idempotency';
import { useQuery } from '../../../hooks/useQuery';
import { useResponsive } from '../../../constants/responsive';
import { CacheTTL } from '../../../services/cache.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { haptics } from '../../../utils/haptics';
import type { WalletTransaction } from '../../../types';
import { LightColors, Elevation } from '../../../constants/colors';

const MIN_PAYOUT = 100;

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
  const { contentMaxWidth } = useResponsive();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  // The withdrawable balance lives on the User row (wallet_balance), NOT
  // on RunnerProfile.total_earnings (which is a lifetime counter and
  // never decreases on payout). Using total_earnings here used to let a
  // runner re-request the same lifetime amount even after they had
  // already withdrawn it.
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const balance = Number(user?.wallet_balance ?? 0);
  // Runner has money but can't cash out yet — turn the "Min ₱100" dead-end
  // on the balance card into forward motion toward their first payout.
  const belowMinimum = balance > 0 && balance < MIN_PAYOUT;
  const payoutProgress = Math.max(0, Math.min(1, balance / MIN_PAYOUT));

  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [bankName, setBankName] = useState(runnerProfile?.bank_name ?? '');
  const [bankAccount, setBankAccount] = useState(runnerProfile?.bank_account_number ?? '');
  const [ewalletNumber, setEwalletNumber] = useState(runnerProfile?.ewallet_number ?? '');
  const [saving, setSaving] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  // Brief SuccessCheck overlay after a payout request is accepted.
  const [showPayoutSuccess, setShowPayoutSuccess] = useState(false);

  const requestedAmount = parseFloat(amountInput) || 0;

  // Reason the Request button is blocked, surfaced inline so a disabled
  // button is recoverable instead of a dead end. Only shown once the
  // runner has actually typed something invalid.
  const amountError =
    amountInput.trim() === ''
      ? null
      : requestedAmount > 0 && requestedAmount < MIN_PAYOUT
      ? `Enter at least ${formatCurrency(MIN_PAYOUT)}`
      : requestedAmount > balance
      ? `Amount exceeds your ${formatCurrency(balance)} available`
      : null;

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

  useEffect(() => {
    if (runnerProfile) {
      setBankName(runnerProfile.bank_name ?? '');
      setBankAccount(runnerProfile.bank_account_number ?? '');
      setEwalletNumber(runnerProfile.ewallet_number ?? '');
    }
  }, [runnerProfile]);

  // wallet_balance in authStore can be stale if the runner completed jobs
  // elsewhere — refresh the withdrawable number on mount so they never act
  // on an outdated balance (under-withdraw or hit a server rejection). This
  // is the most trust-critical figure on the screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await userService.getProfile();
        if (!cancelled && res.data?.data) setUser(res.data.data);
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
      // payout history list so newly-submitted requests appear right
      // away after pull-to-refresh.
      const [prof, prof2] = await Promise.all([
        runnerService.getRunnerProfile(),
        userService.getProfile(),
        payoutsQ.refresh(),
      ]);
      setRunnerProfile(prof.data.data);
      if (prof2.data?.data) setUser(prof2.data.data);
    } catch {}
    setRefreshing(false);
  }, [setRunnerProfile, setUser, payoutsQ]);

  const handleSavePayoutInfo = async () => {
    setSaving(true);
    try {
      // Previously skipped ewallet_number, so the field on screen was
      // purely decorative. Send it now so payouts can route to GCash/Maya.
      await runnerService.updateRunnerProfile({
        bank_name: bankName.trim() || undefined,
        bank_account_number: bankAccount.trim() || undefined,
        ewallet_number: ewalletNumber.trim() || undefined,
      });
      toast.success('Payout information updated');
      await onRefresh();
    } catch (err: any) {
      haptics.error();
      toast.error(errorMessage(err, copy.profile.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  const handleRequestPayout = () => {
    if (requestedAmount < MIN_PAYOUT) {
      haptics.warning();
      toast.error(`The minimum payout is ${formatCurrency(MIN_PAYOUT)}. Enter at least that amount.`);
      return;
    }
    if (requestedAmount > balance) {
      haptics.warning();
      toast.error(`That's more than your available balance of ${formatCurrency(balance)}. Lower the amount and try again.`);
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
              {formatCurrency(balance)}
            </Text>
            {belowMinimum ? (
              // Progress toward the payout minimum — reuses the daily-goal
              // bar's visual language (white fill on a translucent-white
              // track) so the runner sees momentum instead of a locked door.
              <View className="mt-3">
                <Text className="text-[11px] font-inter-semi text-white/90 tabular-nums mb-1.5">
                  {pesos(balance)} of {pesos(MIN_PAYOUT)} to your first payout
                </Text>
                <View
                  className="overflow-hidden"
                  accessibilityRole="progressbar"
                  accessibilityLabel={`${pesos(balance)} of ${pesos(MIN_PAYOUT)} toward your first payout`}
                  accessibilityValue={{ min: 0, max: MIN_PAYOUT, now: Math.round(balance) }}
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
                Withdraw anytime · Min {formatCurrency(MIN_PAYOUT)}
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
              Min {formatCurrency(MIN_PAYOUT)}
            </Text>
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
          </View>
          <Button
            title={pendingPayout ? 'Payout in progress' : 'Request Payout'}
            onPress={handleRequestPayout}
            loading={requesting}
            loadingTitle="Requesting…"
            disabled={
              !!pendingPayout ||
              balance <= 0 ||
              requestedAmount < MIN_PAYOUT ||
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
                description={`Request your first payout once you've earned ${formatCurrency(MIN_PAYOUT)}.`}
              />
            </Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              {recentPayouts.map((tx, idx) => {
                const status = (tx.status ?? 'pending') as 'pending' | 'completed' | 'failed';
                const StatusIcon =
                  status === 'completed' ? CheckCircle2 : status === 'failed' ? XCircle : Clock;
                const statusColor =
                  status === 'completed'
                    ? LightColors.success
                    : status === 'failed'
                    ? LightColors.danger
                    : LightColors.warning;
                // Base tones fail AA at these <17px sizes — the *Dark rung
                // is for status TEXT; base tones stay on glyphs/dots/fills.
                const statusTextColor =
                  status === 'completed'
                    ? LightColors.successDark
                    : status === 'failed'
                    ? LightColors.dangerDark
                    : LightColors.warningDark;
                const statusLabel =
                  status === 'completed' ? 'Paid' : status === 'failed' ? 'Failed' : 'Pending';
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
                            backgroundColor:
                              status === 'pending'
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
                              backgroundColor:
                                status === 'pending' ? 'transparent' : statusColor,
                              borderWidth: status === 'pending' ? 1.5 : 0,
                              borderColor: LightColors.dividerStrong,
                            }}
                          />
                          <Text
                            className={`text-xs ml-2 ${
                              status === 'pending'
                                ? 'font-montserrat text-textTertiary'
                                : 'font-montserrat-semi'
                            }`}
                            style={status === 'pending' ? undefined : { color: statusTextColor }}
                          >
                            {status === 'completed'
                              ? `Paid · ${fmtPayoutDate(tx.processed_at) || 'processed'}`
                              : status === 'failed'
                              ? `Failed · ${fmtPayoutDate(tx.processed_at) || 'processed'}`
                              : 'Processing — usually 1–3 business days'}
                          </Text>
                        </View>
                      </View>
                      {status === 'failed' && tx.failure_reason && (
                        <Text className="text-xs font-montserrat text-dangerDark mt-1" numberOfLines={2}>
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

        {/* Bank Account */}
        <View className="px-5 mb-4">
          <Card className="p-4">
            <View className="flex-row items-center mb-3">
              <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
                <CreditCard size={18} color={LightColors.primary} strokeWidth={1.8} />
              </View>
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                Bank Account
              </Text>
            </View>
            <Text className="text-xs font-montserrat text-textSecondary mb-1">Bank Name</Text>
            <TextInput
              className="bg-surface border border-divider rounded-lg px-3 py-3 text-sm font-montserrat text-textPrimary mb-3"
              style={{ minHeight: 48 }}
              placeholder="e.g. BDO, BPI, Metrobank"
              placeholderTextColor={LightColors.textMuted}
              value={bankName}
              onChangeText={setBankName}
              accessibilityLabel="Bank name"
            />
            <Text className="text-xs font-montserrat text-textSecondary mb-1">Account Number</Text>
            <TextInput
              className="bg-surface border border-divider rounded-lg px-3 py-3 text-sm font-inter tabular-nums text-textPrimary"
              style={{ minHeight: 48 }}
              placeholder="Enter account number"
              placeholderTextColor={LightColors.textMuted}
              value={bankAccount}
              onChangeText={setBankAccount}
              keyboardType="number-pad"
              accessibilityLabel="Bank account number"
            />
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
              onChangeText={setEwalletNumber}
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
        message={`Submit a payout request for ${formatCurrency(requestedAmount)}? Funds will be transferred to your saved account within 1–3 business days.`}
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
