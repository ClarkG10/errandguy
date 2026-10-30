import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { X, Check } from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { PaymentBrandMark } from './PaymentBrandMark';
import { Spinner } from '../ui/Spinner';
import { toast } from '../../stores/toastStore';
import { paymentService } from '../../services/payment.service';
import { useQuery } from '../../hooks/useQuery';
import { useWalletSummary, spendableOnErrands } from '../../hooks/useWalletSummary';
import { CacheTTL } from '../../services/cache.service';
import { useAuthStore } from '../../stores/authStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { LightColors } from '../../constants/colors';
import { formatCurrency } from '../../utils/formatCurrency';
import type { PaymentMethodType } from '../../types';

interface PaymentMethodSelectorProps {
  selected: PaymentMethodType | undefined;
  onSelect: (type: PaymentMethodType) => void;
  /** Amount the booking will charge. The wallet is offered only when its
   *  balance covers it. Omit (or 0) while the fare is still being calculated —
   *  the wallet then shows whenever it holds anything at all. */
  amount?: number;
}

interface PaymentOption {
  type: PaymentMethodType;
  label: string;
  description: string;
}

/**
 * Every way to pay, in the server catalog's order (PaymentMethodCatalog). None
 * needs anything saved: the wallet spends the balance the customer already
 * has, GCash and Maya are a one-time checkout in their app, and cash is
 * collected by the runner.
 */
export const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  { type: 'wallet', label: 'ErrandGuy Wallet', description: 'Pay instantly from your wallet balance' },
  { type: 'gcash', label: 'GCash', description: 'Approve the payment in the GCash app' },
  { type: 'maya', label: 'Maya', description: 'Approve the payment in the Maya app' },
  { type: 'cash', label: 'Cash on Delivery', description: 'Pay your runner directly when the errand is complete' },
];

const optionFor = (type: PaymentMethodType | undefined) =>
  PAYMENT_OPTIONS.find((o) => o.type === type);

export function PaymentMethodSelector({
  selected,
  onSelect,
  amount = 0,
}: PaymentMethodSelectorProps) {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const [showSheet, setShowSheet] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // The default is applied once per mount — re-snapping after the customer
  // changed it would feel like a broken control.
  const autoSelectedRef = useRef(false);

  // Operator-enabled methods. Until loaded every option is offered (the server
  // validates the booking anyway); once loaded, only the enabled subset shows.
  const availableQ = useQuery<Array<{ type: string }>>(
    ['available-methods'],
    async () => {
      const res = await paymentService.getAvailableMethods();
      return (res.data?.data ?? []) as Array<{ type: string }>;
    },
    { staleTime: 5 * 60_000, ttl: CacheTTL.MEDIUM },
  );
  const enabledTypes = availableQ.data
    ? new Set(availableQ.data.map((m) => m.type))
    : null;

  // The wallet is spendable balance + bonus credit (what the server charges
  // against). Offered only once we KNOW it covers the errand: there are no
  // top-ups, so a wallet that can't pay is not a choice at all.
  const walletQ = useWalletSummary();
  const wallet = walletQ.data ?? null;
  const spendable = wallet ? spendableOnErrands(wallet) : null;
  const walletCovers =
    spendable != null && spendable > 0 && (amount <= 0 || spendable >= amount);
  const walletSettled = wallet != null || !!walletQ.error;

  const visible = PAYMENT_OPTIONS.filter(
    (o) =>
      (!enabledTypes || enabledTypes.has(o.type)) &&
      (o.type !== 'wallet' || walletCovers),
  );
  const fallback = visible.find((o) => o.type === 'cash') ?? visible[0] ?? optionFor('cash')!;

  // How this account last paid (persisted on booking-create success by the
  // review screen). A pre-selection only — the customer still sees it here and
  // the amount is on the Confirm button.
  const prefsHydrated = usePreferencesStore((s) => s.isHydrated);
  const lastUsed = usePreferencesStore((s) => s.lastPaymentMethods[userId]);

  // Default pick for a draft with none yet. A draft that already holds one
  // (restored, or chosen earlier) keeps it — the check below moves it only if
  // it can no longer be used.
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (selected) {
      autoSelectedRef.current = true;
      return;
    }
    // The first candidate is the persisted last-used memory — wait one tick
    // for it rather than snapping to Cash and refusing to move.
    if (!prefsHydrated) return;
    // A wallet regular: wait for the balance before deciding, or every
    // booking would open on Cash and then hop to the wallet.
    if (lastUsed?.type === 'wallet' && !walletSettled) return;

    autoSelectedRef.current = true;
    const remembered = visible.find((o) => o.type === lastUsed?.type);
    onSelectRef.current((remembered ?? fallback).type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, availableQ.data, prefsHydrated, lastUsed, walletSettled, walletCovers]);

  // The pick can't be used: the operator switched that method off, or it's
  // the wallet and the balance can't cover this errand (the fare came in
  // higher, or the money was spent elsewhere). Move to a payable method and
  // SAY so — silently changing how someone pays is how they end up owing cash
  // to a runner they expected to pay from their balance.
  const selectedUnavailable =
    !!selected &&
    ((enabledTypes != null && !enabledTypes.has(selected)) ||
      (selected === 'wallet' && wallet != null && !walletCovers));
  useEffect(() => {
    if (!selectedUnavailable || !selected) return;
    onSelectRef.current(fallback.type);
    toast.info(
      selected === 'wallet'
        ? `Your wallet balance can’t cover this errand — switched to ${fallback.label}`
        : `${optionFor(selected)?.label ?? 'That method'} isn’t available right now — switched to ${fallback.label}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnavailable]);

  const walletLine = (() => {
    if (!wallet || spendable == null) return null;
    const base = `Balance ${formatCurrency(spendable)}`;
    return wallet.bonus_balance > 0
      ? `${base} · includes ${formatCurrency(wallet.bonus_balance)} bonus credit`
      : base;
  })();

  const active = optionFor(selected);
  const activeSub =
    active?.type === 'wallet' && walletLine ? walletLine : active?.description;

  const renderRow = (opt: PaymentOption) => {
    const isSelected = selected === opt.type;
    const sub = opt.type === 'wallet' && walletLine ? walletLine : opt.description;

    return (
      <Pressable
        key={opt.type}
        accessibilityRole="button"
        accessibilityLabel={`${opt.label}. ${sub}`}
        accessibilityState={{ selected: isSelected }}
        className={`flex-row items-center rounded-xl px-2 py-3 ${isSelected ? 'bg-primaryLight' : ''}`}
        // Sheet-list rows take the flat surfaceMuted press wash, not the
        // card scale treatment.
        style={({ pressed }) =>
          pressed ? { backgroundColor: LightColors.surfaceMuted } : null
        }
        android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onSelect(opt.type);
          setShowSheet(false);
        }}
      >
        <PaymentBrandMark type={opt.type} size={40} />
        <View className="flex-1 ml-3">
          <Text className="text-sm font-montserrat-bold text-textPrimary">
            {opt.label}
          </Text>
          <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
            {sub}
          </Text>
        </View>
        {isSelected && <Check size={20} color={LightColors.primary} />}
      </Pressable>
    );
  };

  return (
    <View className="mb-4">
      <Text
        className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
        style={{ letterSpacing: 1.4 }}
      >
        Payment method
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Payment method: ${active?.label ?? 'none selected'}. Change`}
        className="flex-row items-center border border-divider rounded-xl px-4 py-3.5 bg-surface"
        style={({ pressed }) =>
          pressed ? { backgroundColor: LightColors.surfaceMuted } : null
        }
        android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setShowSheet(true);
        }}
      >
        {active ? (
          <>
            <PaymentBrandMark type={active.type} size={40} />
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-bold text-textPrimary">
                {active.label}
              </Text>
              {activeSub ? (
                <Text className="text-[11px] font-montserrat text-textSecondary">
                  {activeSub}
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          // Spinner sits in the same 40pt slot as the method mark so the
          // trigger doesn't change height once the default is picked.
          <View className="flex-1 flex-row items-center">
            <View className="w-10 h-10 items-center justify-center">
              <Spinner size="small" color={LightColors.primary} />
            </View>
            <Text className="flex-1 ml-3 text-[14px] font-montserrat-bold text-textPrimary">
              Select payment method
            </Text>
          </View>
        )}
        <Text className="text-xs font-montserrat-bold text-primary">Change</Text>
      </Pressable>

      <BottomSheet
        isVisible={showSheet}
        onClose={() => setShowSheet(false)}
        snapPoints={[0.6]}
      >
        {/* BottomSheet already pads 16px horizontally + 24px bottom — px-1
            tops the gutter up to the app's 20px, instead of stacking a
            second full gutter on top (36px squeezed the rows on 360dp). */}
        <View className="px-1 pb-2">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-lg font-montserrat-bold text-textPrimary">
              Payment method
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close payment method sheet"
              hitSlop={10}
              onPress={() => setShowSheet(false)}
            >
              <X size={24} color={LightColors.textSecondary} />
            </Pressable>
          </View>

          {visible.map(renderRow)}
        </View>
      </BottomSheet>
    </View>
  );
}
