import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  CreditCard,
  Plus,
  Trash2,
  ShieldCheck,
  Star,
} from 'lucide-react-native';
import { Spinner } from '../../components/ui/Spinner';
import { PaymentBrandMark } from '../../components/customer/PaymentBrandMark';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { Eyebrow } from '../../components/ui/Typography';
import { Skeleton, SkeletonCircle } from '../../components/ui/Skeleton';
import { BrandRefreshControl } from '../../components/ui/BrandRefreshControl';
import { paymentService } from '../../services/payment.service';
import { runOptimistic } from '../../utils/optimistic';
import { errorMessage } from '../../utils/errorCatalog';
import { queueable } from '../../services/mutationQueue';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { useAuthStore } from '../../stores/authStore';
import {
  openCheckoutUrl,
  PAYMENT_RETURN_URL,
  type CheckoutOutcome,
} from '../../utils/browser';
import { LightColors, Elevation } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';
import { copy } from '../../constants/copy';
import { toast } from '../../stores/toastStore';
import type { PaymentMethod, PaymentMethodType } from '../../types';
import type { PaymentMethodStatus } from '../../types/payment';

type LinkChannel = 'gcash' | 'maya' | 'grabpay';

const LINK_OPTIONS: { channel: LinkChannel; label: string }[] = [
  { channel: 'gcash', label: 'GCash' },
  { channel: 'maya', label: 'Maya' },
  { channel: 'grabpay', label: 'GrabPay' },
];

const LINK_CHANNELS: LinkChannel[] = ['gcash', 'maya', 'grabpay'];
const isLinkChannel = (t: PaymentMethodType): t is LinkChannel =>
  (LINK_CHANNELS as string[]).includes(t);

// Undefined status = active/chargeable (see PaymentMethod.status).
const resolveStatus = (s?: PaymentMethodStatus): PaymentMethodStatus =>
  s ?? 'active';

interface StatusMeta {
  text: string;
  color: string;
  /** true for methods that can't be charged (expired/failed) — de-emphasised. */
  dead: boolean;
}

function statusMeta(status: PaymentMethodStatus): StatusMeta {
  switch (status) {
    case 'pending':
      return { text: 'Pending authorization…', color: LightColors.warningDark, dead: false };
    case 'expired':
      return { text: 'Needs re-linking', color: LightColors.dangerDark, dead: true };
    case 'failed':
      return { text: 'Link failed', color: LightColors.dangerDark, dead: true };
    default:
      return { text: 'Linked', color: LightColors.successDark, dead: false };
  }
}

function MethodsSkeleton() {
  return (
    <View>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          className="flex-row items-center rounded-2xl bg-surface pl-4 pr-2 py-3.5 mb-2.5"
          style={Elevation.sm}
        >
          <SkeletonCircle size={40} />
          <View className="flex-1 ml-3">
            <Skeleton width="45%" height={14} style={{ marginBottom: 6 }} />
            <Skeleton width="60%" height={11} />
          </View>
          {/* 44-tall slot mirrors the real row's action box so heights
              match and rows don't nudge up 4px when content lands. */}
          <View className="w-11 h-11 items-center justify-center">
            <SkeletonCircle size={20} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function PaymentMethodsScreen() {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const [linking, setLinking] = useState<LinkChannel | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PaymentMethod | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const methodsQ = useQuery<PaymentMethod[]>(
    ['payment-methods', userId],
    async () => {
      const res = await paymentService.getPaymentMethods();
      return (res.data?.data ?? []) as PaymentMethod[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  const methods = methodsQ.data ?? [];
  const loading = methodsQ.loading && !methodsQ.data;
  const loadFailed = !!methodsQ.error && methods.length === 0;

  // A channel already linked/pending can't be linked again (would mint a
  // duplicate payment identity). Expired/failed methods stay linkable so
  // the user can recover them.
  const linkableOptions = LINK_OPTIONS.filter(
    (opt) =>
      !methods.some((m) => {
        if (m.type !== opt.channel) return false;
        const s = resolveStatus(m.status);
        return s === 'active' || s === 'pending';
      }),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await methodsQ.refresh();
    setRefreshing(false);
  }, [methodsQ]);

  const handleLink = useCallback(
    async (channel: LinkChannel) => {
      if (linking) return;
      setLinking(channel);
      try {
        const res = await paymentService.linkEwallet(channel);
        const actionUrl: string | undefined = res.data?.action_url;
        let outcome: CheckoutOutcome = 'success';
        if (actionUrl) {
          // Authorize the link in the in-app sheet; it auto-closes on return.
          outcome = await openCheckoutUrl(actionUrl, PAYMENT_RETURN_URL);
        }
        // Refetch to reflect the true status regardless of outcome.
        await methodsQ.refresh();
        if (outcome === 'cancelled') {
          toast.info('Linking cancelled — no account was linked.');
        } else if (outcome === 'failed') {
          toast.error("Linking didn't complete. Please try again.");
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          toast.info('Finishing up — your linked account will show as active once confirmed.');
        }
      } catch (err: any) {
        toast.error(errorMessage(err, copy.payment.linkFailed));
      } finally {
        setLinking(null);
      }
    },
    [linking, methodsQ],
  );

  const handleSetDefault = useCallback(
    async (m: PaymentMethod) => {
      if (m.is_default || resolveStatus(m.status) !== 'active' || settingDefault) return;
      setSettingDefault(m.id);
      // Optimistic: move the default flag to this row instantly. The service
      // invalidates ['payment-methods'] on success, which reconciles with
      // server truth (incl. any auto-promotion of another method).
      const prev = methodsQ.data;
      // Which method is "default" is a display preference (no money moves), so
      // it's safe to keep + replay if the tap happens offline.
      const q = queueable('payment.setDefaultMethod', { id: m.id }, {
        dedupeKey: 'payment-default',
      });
      await runOptimistic({
        apply: () =>
          methodsQ.mutate((list) =>
            (list ?? []).map((x) => ({ ...x, is_default: x.id === m.id })),
          ),
        rollback: () => methodsQ.mutate(() => prev ?? []),
        commit: q.commit,
        offline: q.offline,
        errorMessage: 'Could not set default. Please try again.',
        retry: true,
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          toast.success('Default updated.');
        },
      });
      setSettingDefault(null);
    },
    [methodsQ, settingDefault],
  );

  const handleRemove = useCallback(async () => {
    const m = removing;
    setRemoving(null);
    if (!m) return;
    // Optimistic: drop the row immediately, restore it if the delete fails.
    const prev = methodsQ.data;
    await runOptimistic({
      apply: () => methodsQ.mutate((list) => (list ?? []).filter((x) => x.id !== m.id)),
      rollback: () => methodsQ.mutate(() => prev ?? []),
      commit: () => paymentService.removePaymentMethod(m.id),
      errorMessage: 'Could not remove. Please try again.',
      retry: true,
      onSuccess: () => toast.success('Payment method removed.'),
    });
  }, [removing, methodsQ]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Payment Methods"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
      />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 24,
        }}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View className="h-4" />

        {/* Saved / linked methods */}
        <Eyebrow className="mb-2">Your linked accounts</Eyebrow>

        {loading ? (
          <MethodsSkeleton />
        ) : loadFailed ? (
          <ErrorState
            title="Couldn't load your payment methods"
            onRetry={() => {
              void methodsQ.refresh();
            }}
          />
        ) : methods.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No linked accounts yet"
            description="Link an e-wallet below to pay in one tap next time."
          />
        ) : (
          methods.map((m) => {
            const status = resolveStatus(m.status);
            const meta = statusMeta(status);
            const canSetDefault = status === 'active' && !m.is_default;
            const needsAction =
              (status === 'pending' || status === 'expired' || status === 'failed') &&
              isLinkChannel(m.type);
            const actionLabel = status === 'pending' ? 'Continue' : 'Re-link';
            const actionBusy = isLinkChannel(m.type) && linking === m.type;
            const actionDisabled = linking != null && !actionBusy;
            const settingThis = settingDefault === m.id;
            const maskedId =
              m.card_brand && m.last_four
                ? `${m.card_brand} •••• ${m.last_four}`
                : m.last_four
                  ? `•••• ${m.last_four}`
                  : null;

            return (
              <View
                key={m.id}
                className="flex-row items-center rounded-2xl bg-surface pl-4 pr-2 py-3.5 mb-2.5"
                style={Elevation.sm}
              >
                <PaymentBrandMark
                  type={m.type}
                  brand={m.card_brand}
                  size={40}
                  style={meta.dead ? { opacity: 0.45 } : undefined}
                />
                <View className="flex-1 ml-3">
                  <View className="flex-row items-center">
                    <Text
                      numberOfLines={1}
                      className="shrink text-[14px] font-montserrat-bold"
                      style={{
                        color: meta.dead
                          ? LightColors.textSecondary
                          : LightColors.textPrimary,
                      }}
                    >
                      {m.label}
                    </Text>
                    {m.is_default && status === 'active' && (
                      <View
                        className="ml-2 px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: LightColors.primaryLight }}
                      >
                        <Text
                          className="text-[10px] font-montserrat-bold text-primary uppercase"
                          style={{ letterSpacing: 0.6 }}
                        >
                          Default
                        </Text>
                      </View>
                    )}
                  </View>
                  <View className="flex-row items-center mt-0.5">
                    {maskedId && (
                      <Text
                        numberOfLines={1}
                        className="shrink text-[11px] font-montserrat text-textTertiary"
                      >
                        {maskedId}
                        <Text className="text-textTertiary">{'  ·  '}</Text>
                      </Text>
                    )}
                    <Text
                      numberOfLines={1}
                      className="text-[11px] font-montserrat"
                      style={{ color: meta.color }}
                    >
                      {meta.text}
                    </Text>
                  </View>
                </View>

                {/* Recovery action for pending / expired / failed methods. */}
                {needsAction && (
                  <Pressable
                    disabled={actionDisabled}
                    onPress={() => handleLink(m.type as LinkChannel)}
                    className="h-11 px-2.5 items-center justify-center"
                    style={({ pressed }) => [
                      pressed && { opacity: 0.6 },
                      actionDisabled && { opacity: 0.4 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${actionLabel} linking ${m.label}`}
                    accessibilityState={{ disabled: actionDisabled, busy: actionBusy }}
                  >
                    {actionBusy ? (
                      <Spinner size="small" color={LightColors.primary} />
                    ) : (
                      <Text className="text-[13px] font-montserrat-bold text-primary">
                        {actionLabel}
                      </Text>
                    )}
                  </Pressable>
                )}

                {/* Set-default — explicit 44×44 box, spaced from Remove. */}
                {canSetDefault && (
                  <Pressable
                    disabled={settingDefault != null}
                    onPress={() => handleSetDefault(m)}
                    className="w-11 h-11 items-center justify-center"
                    style={({ pressed }) => [
                      pressed && { opacity: 0.6 },
                      settingDefault != null && !settingThis && { opacity: 0.4 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Set ${m.label} as default`}
                    accessibilityState={{ disabled: settingDefault != null, busy: settingThis }}
                  >
                    {settingThis ? (
                      <Spinner size="small" color={LightColors.primary} />
                    ) : (
                      <Star size={18} color={LightColors.textTertiary} />
                    )}
                  </Pressable>
                )}

                {/* Remove — visually last, its own 44×44 box (no overlap). */}
                <Pressable
                  onPress={() => {
                    Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Warning,
                    ).catch(() => {});
                    setRemoving(m);
                  }}
                  className="w-11 h-11 items-center justify-center"
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${m.label}`}
                >
                  <Trash2 size={18} color={LightColors.danger} />
                </Pressable>
              </View>
            );
          })
        )}

        {/* Link a new e-wallet */}
        {linkableOptions.length > 0 && (
          <>
            <Eyebrow className="mt-5 mb-2">Link an e-wallet</Eyebrow>
            {linkableOptions.map((opt) => {
              const busy = linking === opt.channel;
              const disabled = linking != null;
              return (
                <Pressable
                  key={opt.channel}
                  disabled={disabled}
                  onPress={() => handleLink(opt.channel)}
                  accessibilityRole="button"
                  accessibilityLabel={`Link ${opt.label}`}
                  accessibilityState={{ disabled, busy }}
                  className="flex-row items-center rounded-2xl bg-surface px-4 py-3.5 mb-2.5"
                  style={({ pressed }) => [
                    Elevation.sm,
                    pressed && !disabled && { opacity: 0.85 },
                    disabled && !busy && { opacity: 0.5 },
                  ]}
                >
                  <PaymentBrandMark type={opt.channel} size={40} />
                  <Text className="flex-1 ml-3 text-[14px] font-montserrat-bold text-textPrimary">
                    {opt.label}
                  </Text>
                  {busy ? (
                    <Spinner size="small" color={LightColors.primary} />
                  ) : (
                    <Plus size={20} color={LightColors.primary} />
                  )}
                </Pressable>
              );
            })}
          </>
        )}

        {/* Cards — usable at checkout today; saving for reuse is coming next. */}
        <View
          className="flex-row items-start rounded-2xl px-4 py-3.5 mt-3"
          style={{ backgroundColor: LightColors.divider }}
        >
          <CreditCard size={18} color={LightColors.primary} style={{ marginTop: 1 }} />
          <Text className="flex-1 ml-3 text-[12px] font-montserrat text-textSecondary leading-[17px]">
            Paying by card? Choose{' '}
            <Text className="font-montserrat-bold text-textPrimary">Credit / Debit Card</Text> at
            checkout. Saving a card for one-tap payments is coming soon.
          </Text>
        </View>

        <View className="flex-row items-center justify-center mt-5">
          <ShieldCheck size={14} color={LightColors.textTertiary} />
          <Text className="ml-1.5 text-[12px] font-montserrat text-textTertiary">
            Linking is secured by Xendit. We never see your credentials.
          </Text>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={removing != null}
        title="Remove payment method?"
        message={`Remove ${removing?.label ?? 'this method'}? You can link it again anytime.`}
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onConfirm={handleRemove}
        onCancel={() => setRemoving(null)}
      />
    </View>
  );
}
