import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Wallet, CreditCard, Smartphone, Clock, CheckCircle2, XCircle } from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { userService } from '../../../services/user.service';
import { runnerService } from '../../../services/runner.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { formatCurrency } from '../../../utils/formatCurrency';
import { toast } from '../../../stores/toastStore';
import type { WalletTransaction } from '../../../types';

const MIN_PAYOUT = 100;

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
  const router = useRouter();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  // The withdrawable balance lives on the User row (wallet_balance), NOT
  // on RunnerProfile.total_earnings (which is a lifetime counter and
  // never decreases on payout). Using total_earnings here used to let a
  // runner re-request the same lifetime amount even after they had
  // already withdrawn it.
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const balance = Number(user?.wallet_balance ?? 0);

  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [bankName, setBankName] = useState(runnerProfile?.bank_name ?? '');
  const [bankAccount, setBankAccount] = useState(runnerProfile?.bank_account_number ?? '');
  const [ewalletNumber, setEwalletNumber] = useState(runnerProfile?.ewallet_number ?? '');
  const [saving, setSaving] = useState(false);
  const [amountInput, setAmountInput] = useState('');

  const requestedAmount = parseFloat(amountInput) || 0;

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
      toast.error(err?.response?.data?.message ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestPayout = () => {
    if (requestedAmount < MIN_PAYOUT) {
      toast.error(`Minimum payout is ${formatCurrency(MIN_PAYOUT)}`);
      return;
    }
    if (requestedAmount > balance) {
      toast.error('Amount exceeds your available balance');
      return;
    }
    setShowRequestModal(true);
  };

  const confirmRequestPayout = async () => {
    setRequesting(true);
    try {
      await runnerService.requestPayout(requestedAmount);
      toast.success('Payout request submitted');
      setShowRequestModal(false);
      setAmountInput('');
      await onRefresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to request payout');
    } finally {
      setRequesting(false);
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
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Balance Card — switched from a flat primary-tinted Card to a
            slate fintech panel so the available-for-payout amount feels
            more like a bank statement than another marketing CTA. */}
        <View className="px-5 mb-4">
          <View
            className="rounded-3xl p-6 overflow-hidden"
            style={{
              backgroundColor: '#0F172A',
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.18,
              shadowRadius: 20,
              elevation: 6,
            }}
          >
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -50,
                right: -40,
                width: 170,
                height: 170,
                borderRadius: 85,
                backgroundColor: '#22C55E',
                opacity: 0.18,
              }}
            />
            <View className="flex-row items-center mb-2">
              <View className="w-9 h-9 rounded-full bg-white/10 items-center justify-center mr-2.5">
                <Wallet size={18} color="#FFFFFF" />
              </View>
              <Text className="text-xs font-montserrat-semi text-white/60 uppercase tracking-wider">
                Available for payout
              </Text>
            </View>
            <Text className="text-4xl font-inter-semi tabular-nums text-white">
              {formatCurrency(balance)}
            </Text>
            <Text className="text-[11px] font-montserrat text-white/50 mt-1">
              Withdraw anytime · Min {formatCurrency(MIN_PAYOUT)}
            </Text>
          </View>
        </View>

        {/* Pending payout banner — if a payout request is still being
            processed, surface it prominently and disable the request
            button so the runner can't accidentally double-submit. */}
        {pendingPayout && (
          <View className="px-5 mb-4">
            <Card className="flex-row items-center gap-3 p-3 bg-warningLight">
              <Clock size={18} color="#B45309" />
              <View className="flex-1">
                <Text className="text-sm font-montserrat-semi" style={{ color: '#B45309' }}>
                  Payout in progress
                </Text>
                <Text className="text-xs font-montserrat mt-0.5" style={{ color: '#92400E' }}>
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
          <TextInput
            className="bg-surface border border-divider rounded-xl px-3 py-3 text-base font-inter-semi text-textPrimary mb-2"
            placeholder="₱0.00"
            placeholderTextColor="#94A3B8"
            value={amountInput}
            onChangeText={(v) => setAmountInput(sanitizeAmount(v))}
            keyboardType="decimal-pad"
          />
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-[11px] font-montserrat text-textTertiary">
              Min {formatCurrency(MIN_PAYOUT)}
            </Text>
            <Pressable
              onPress={() => setAmountInput(String(balance))}
              hitSlop={6}
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
            disabled={
              !!pendingPayout ||
              balance <= 0 ||
              requestedAmount < MIN_PAYOUT ||
              requestedAmount > balance
            }
            fullWidth
          />
        </View>

        {/* Recent Payouts — last 5 payout requests with real status
            badges (pending / completed / failed) so the runner has an
            accurate audit trail without leaving the screen. */}
        {recentPayouts.length > 0 && (
          <View className="px-5 mb-6">
            <Text className="text-xs font-montserrat-bold text-textSecondary uppercase tracking-wider mb-2">
              Recent Payouts
            </Text>
            <Card className="p-0 overflow-hidden">
              {recentPayouts.map((tx, idx) => {
                const status = (tx.status ?? 'pending') as 'pending' | 'completed' | 'failed';
                const StatusIcon =
                  status === 'completed' ? CheckCircle2 : status === 'failed' ? XCircle : Clock;
                const statusColor =
                  status === 'completed' ? '#16A34A' : status === 'failed' ? '#DC2626' : '#B45309';
                const statusLabel =
                  status === 'completed' ? 'Paid' : status === 'failed' ? 'Failed' : 'Pending';
                return (
                  <View
                    key={tx.id}
                    className={`flex-row items-center px-4 py-3 ${
                      idx < recentPayouts.length - 1 ? 'border-b border-divider' : ''
                    }`}
                  >
                    <StatusIcon size={18} color={statusColor} />
                    <View className="flex-1 ml-3">
                      <Text className="text-sm font-inter-semi tabular-nums text-textPrimary">
                        {formatCurrency(Math.abs(Number(tx.amount ?? 0)))}
                      </Text>
                      <Text className="text-xs font-montserrat text-textTertiary">
                        {new Date(tx.created_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                      {status === 'failed' && tx.failure_reason && (
                        <Text className="text-[11px] font-montserrat text-danger mt-1" numberOfLines={2}>
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
                        style={{ color: statusColor }}
                      >
                        {statusLabel}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        )}

        {/* Bank Account */}
        <View className="px-5 mb-4">
          <View className="flex-row items-center gap-2 mb-2">
            <CreditCard size={16} color="#475569" />
            <Text className="text-sm font-montserrat-bold text-textSecondary">
              Bank Account
            </Text>
          </View>
          <Card className="p-4">
            <Text className="text-xs font-montserrat text-textSecondary mb-1">Bank Name</Text>
            <TextInput
              className="bg-surface border border-divider rounded-xl px-3 py-2.5 text-sm font-montserrat text-textPrimary mb-3"
              placeholder="e.g. BDO, BPI, Metrobank"
              placeholderTextColor="#94A3B8"
              value={bankName}
              onChangeText={setBankName}
            />
            <Text className="text-xs font-montserrat text-textSecondary mb-1">Account Number</Text>
            <TextInput
              className="bg-surface border border-divider rounded-xl px-3 py-2.5 text-sm font-montserrat text-textPrimary"
              placeholder="Enter account number"
              placeholderTextColor="#94A3B8"
              value={bankAccount}
              onChangeText={setBankAccount}
              keyboardType="number-pad"
            />
          </Card>
        </View>

        {/* E-Wallet */}
        <View className="px-5 mb-4">
          <View className="flex-row items-center gap-2 mb-2">
            <Smartphone size={16} color="#475569" />
            <Text className="text-sm font-montserrat-bold text-textSecondary">
              E-Wallet
            </Text>
          </View>
          <Card className="p-4">
            <Text className="text-xs font-montserrat text-textSecondary mb-1">E-Wallet Number</Text>
            <TextInput
              className="bg-surface border border-divider rounded-xl px-3 py-2.5 text-sm font-montserrat text-textPrimary"
              placeholder="e.g. GCash, Maya number"
              placeholderTextColor="#94A3B8"
              value={ewalletNumber}
              onChangeText={setEwalletNumber}
              keyboardType="phone-pad"
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
            fullWidth
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={showRequestModal}
        title="Request payout?"
        message={`Submit a payout request for ${formatCurrency(requestedAmount)}? Funds will be transferred to your saved account within 1–3 business days.`}
        confirmLabel="Request"
        cancelLabel="Cancel"
        loading={requesting}
        onConfirm={confirmRequestPayout}
        onCancel={() => setShowRequestModal(false)}
      />
    </View>
  );
}
