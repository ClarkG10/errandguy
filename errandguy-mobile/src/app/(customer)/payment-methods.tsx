import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import {
  Smartphone,
  CreditCard,
  Plus,
  Trash2,
  Check,
  ShieldCheck,
  Star,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { paymentService } from '../../services/payment.service';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { useAuthStore } from '../../stores/authStore';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../../utils/browser';
import { LightColors } from '../../constants/colors';
import { toast } from '../../stores/toastStore';
import type { PaymentMethod, PaymentMethodType } from '../../types';

const METHOD_ICONS: Partial<Record<PaymentMethodType, LucideIcon>> = {
  gcash: Smartphone,
  maya: Smartphone,
  grabpay: Smartphone,
  card: CreditCard,
};

type LinkChannel = 'gcash' | 'maya' | 'grabpay';

const LINK_OPTIONS: { channel: LinkChannel; label: string }[] = [
  { channel: 'gcash', label: 'GCash' },
  { channel: 'maya', label: 'Maya' },
  { channel: 'grabpay', label: 'GrabPay' },
];

export default function PaymentMethodsScreen() {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const [linking, setLinking] = useState<LinkChannel | null>(null);
  const [removing, setRemoving] = useState<PaymentMethod | null>(null);

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

  const handleLink = useCallback(
    async (channel: LinkChannel) => {
      if (linking) return;
      setLinking(channel);
      try {
        const res = await paymentService.linkEwallet(channel);
        const actionUrl: string | undefined = res.data?.action_url;
        if (actionUrl) {
          // Authorize the link in the in-app sheet; it auto-closes on return.
          await openCheckoutUrl(actionUrl, PAYMENT_RETURN_URL);
        }
        // Whether authorized or already active, refetch to reflect status.
        await methodsQ.refresh();
        toast.info('Finishing up — your linked account will show as active once confirmed.');
      } catch (err: any) {
        toast.error(err?.response?.data?.message ?? 'Could not start linking. Please try again.');
      } finally {
        setLinking(null);
      }
    },
    [linking, methodsQ],
  );

  const handleSetDefault = useCallback(
    async (m: PaymentMethod) => {
      if (m.is_default || m.status !== 'active') return;
      try {
        await paymentService.setDefaultMethod(m.id);
        await methodsQ.refresh();
      } catch {
        toast.error('Could not set default. Please try again.');
      }
    },
    [methodsQ],
  );

  const handleRemove = useCallback(async () => {
    const m = removing;
    setRemoving(null);
    if (!m) return;
    try {
      await paymentService.removePaymentMethod(m.id);
      await methodsQ.refresh();
      toast.success('Payment method removed.');
    } catch {
      toast.error('Could not remove. Please try again.');
    }
  }, [removing, methodsQ]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Payment Methods" showBack fallbackHref="/(customer)/(tabs)" />

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        <View className="h-4" />

        {/* Saved / linked methods */}
        <Text
          className="text-[11px] font-montserrat-bold uppercase text-textSecondary mb-2"
          style={{ letterSpacing: 1.2 }}
        >
          Your linked accounts
        </Text>

        {loading ? (
          <View className="py-10 items-center">
            <ActivityIndicator color={LightColors.primary} />
          </View>
        ) : methods.length === 0 ? (
          <View className="rounded-2xl bg-surface border border-divider px-4 py-6 items-center mb-2">
            <View
              className="w-12 h-12 rounded-full items-center justify-center mb-3"
              style={{ backgroundColor: LightColors.primaryLight }}
            >
              <CreditCard size={22} color={LightColors.primary} />
            </View>
            <Text className="text-sm font-montserrat-bold text-textPrimary mb-1">
              No linked accounts yet
            </Text>
            <Text className="text-xs font-montserrat text-textSecondary text-center">
              Link an e-wallet below to pay in one tap next time.
            </Text>
          </View>
        ) : (
          methods.map((m) => {
            const Icon = METHOD_ICONS[m.type] ?? CreditCard;
            const pending = m.status === 'pending';
            return (
              <View
                key={m.id}
                className="flex-row items-center rounded-2xl bg-surface border border-divider px-4 py-3.5 mb-2.5"
              >
                <View
                  className="w-10 h-10 rounded-full items-center justify-center"
                  style={{ backgroundColor: LightColors.primaryLight }}
                >
                  <Icon size={19} color={LightColors.primary} />
                </View>
                <View className="flex-1 ml-3">
                  <View className="flex-row items-center">
                    <Text className="text-[14px] font-montserrat-bold text-textPrimary">
                      {m.label}
                    </Text>
                    {m.is_default && !pending && (
                      <View
                        className="ml-2 px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: LightColors.primaryLight }}
                      >
                        <Text className="text-[9px] font-montserrat-bold text-primary uppercase">
                          Default
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    className="text-[11px] font-montserrat mt-0.5"
                    style={{ color: pending ? LightColors.warning : LightColors.success }}
                  >
                    {pending ? 'Pending authorization…' : 'Linked'}
                  </Text>
                </View>

                {!pending && !m.is_default && (
                  <Pressable
                    hitSlop={8}
                    onPress={() => handleSetDefault(m)}
                    className="mr-3"
                    accessibilityLabel="Set as default"
                  >
                    <Star size={18} color={LightColors.textMuted} />
                  </Pressable>
                )}
                <Pressable
                  hitSlop={8}
                  onPress={() => setRemoving(m)}
                  accessibilityLabel="Remove"
                >
                  <Trash2 size={18} color={LightColors.danger} />
                </Pressable>
              </View>
            );
          })
        )}

        {/* Link a new e-wallet */}
        <Text
          className="text-[11px] font-montserrat-bold uppercase text-textSecondary mt-5 mb-2"
          style={{ letterSpacing: 1.2 }}
        >
          Link an e-wallet
        </Text>
        {LINK_OPTIONS.map((opt) => {
          const busy = linking === opt.channel;
          const disabled = linking != null;
          return (
            <Pressable
              key={opt.channel}
              disabled={disabled}
              onPress={() => handleLink(opt.channel)}
              className="flex-row items-center rounded-2xl bg-surface border border-divider px-4 py-3.5 mb-2.5"
              style={disabled && !busy ? { opacity: 0.5 } : undefined}
            >
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: LightColors.primaryLight }}
              >
                <Smartphone size={19} color={LightColors.primary} />
              </View>
              <Text className="flex-1 ml-3 text-[14px] font-montserrat-bold text-textPrimary">
                {opt.label}
              </Text>
              {busy ? (
                <ActivityIndicator size="small" color={LightColors.primary} />
              ) : (
                <Plus size={20} color={LightColors.primary} />
              )}
            </Pressable>
          );
        })}

        {/* Cards — usable at checkout today; saving for reuse is coming next. */}
        <View
          className="flex-row items-start rounded-2xl px-4 py-3.5 mt-3"
          style={{ backgroundColor: LightColors.primaryLight }}
        >
          <CreditCard size={18} color={LightColors.primary} style={{ marginTop: 1 }} />
          <Text className="flex-1 ml-3 text-[12px] font-montserrat text-textSecondary leading-[17px]">
            Paying by card? Choose{' '}
            <Text className="font-montserrat-bold text-textPrimary">Credit / Debit Card</Text> at
            checkout. Saving a card for one-tap payments is coming soon.
          </Text>
        </View>

        <View className="flex-row items-center justify-center mt-5 mb-10">
          <ShieldCheck size={13} color={LightColors.textMuted} />
          <Text className="ml-1.5 text-[11px] font-montserrat text-textMuted">
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
