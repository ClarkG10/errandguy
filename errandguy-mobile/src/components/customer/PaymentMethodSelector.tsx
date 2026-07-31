import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { X, Check } from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { PaymentBrandMark } from './PaymentBrandMark';
import { Spinner } from '../ui/Spinner';
import { toast } from '../../stores/toastStore';
import { paymentService } from '../../services/payment.service';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { useAuthStore } from '../../stores/authStore';
import { LightColors } from '../../constants/colors';
import { formatCurrency } from '../../utils/formatCurrency';
import type { PaymentMethod, PaymentMethodType } from '../../types';

interface PaymentMethodSelectorProps {
  selectedId: string | undefined;
  onSelect: (id: string, type: PaymentMethodType) => void;
  /** Amount the booking will charge. Used to disable the wallet option when
   *  the balance can't cover it. Omit (or 0) to skip the balance check
   *  (e.g. negotiate flow where the price isn't fixed yet). */
  amount?: number;
}

// Universal settlement choices. None of these require a pre-saved/tokenised
// method: wallet deducts the in-app balance, cash is collected on delivery,
// and gcash/maya/card route through a Xendit hosted checkout at booking time.
// Their ids are sentinels (prefixed "__") so the booking payload omits
// payment_method_id for them (see review.tsx).
interface StandardOption {
  id: string;
  type: PaymentMethodType;
  label: string;
  description: string;
}

const STANDARD_OPTIONS: StandardOption[] = [
  { id: '__wallet__', type: 'wallet', label: 'ErrandGuy Wallet', description: 'Pay instantly from your wallet balance' },
  { id: '__gcash__', type: 'gcash', label: 'GCash', description: 'Pay online via GCash' },
  { id: '__maya__', type: 'maya', label: 'Maya', description: 'Pay online via Maya' },
  { id: '__card__', type: 'card', label: 'Credit / Debit Card', description: 'Pay online with your card' },
  { id: '__cash__', type: 'cash', label: 'Cash on Delivery', description: 'Pay your runner directly when the errand is complete' },
];

const CASH_OPTION = STANDARD_OPTIONS[STANDARD_OPTIONS.length - 1];

/**
 * Resolve a sentinel selection id ('__gcash__' etc.) to its settlement
 * type. Screens that persist only the id (the booking draft) derive the
 * submitted `payment_method` through this instead of callback-captured
 * state, so the payload can never disagree with the visible selection —
 * e.g. on a rehydrated draft before any onSelect has fired. Saved-method
 * ids resolve to undefined (their type arrives via onSelect once the
 * methods list loads).
 */
export function resolvePaymentMethodType(
  id: string | undefined,
): PaymentMethodType | undefined {
  return STANDARD_OPTIONS.find((o) => o.id === id)?.type;
}

export function PaymentMethodSelector({
  selectedId,
  onSelect,
  amount = 0,
}: PaymentMethodSelectorProps) {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const router = useRouter();
  const [showSheet, setShowSheet] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // Track that we've already auto-applied the default once for this
  // component instance — without this guard, removing the user's pick in
  // the sheet would immediately re-snap back to the default after the
  // next refetch, which feels like a broken UI.
  const autoSelectedRef = useRef(false);

  // Cache-first read so the booking review screen can paint instantly
  // on revisit. Invalidations from setDefaultMethod / addPaymentMethod /
  // removePaymentMethod (paymentService) push fresh data automatically.
  const methodsQ = useQuery<PaymentMethod[]>(
    ['payment-methods', userId],
    async () => {
      const res = await paymentService.getPaymentMethods();
      return (res.data?.data ?? []) as PaymentMethod[];
    },
    { staleTime: 60_000, ttl: CacheTTL.MEDIUM },
  );

  // Only ACTIVE saved methods are chargeable — a pending (not-yet-authorized)
  // linked account can't be used to pay yet, so it's not offered here.
  const methods = (methodsQ.data ?? []).filter(
    (m) => !m.status || m.status === 'active',
  );
  const loading = methodsQ.loading && !methodsQ.data;

  // Live wallet balance so we can show it and disable the wallet option when
  // it can't cover the amount. Shares the ['wallet','balance'] cache key with
  // the wallet screen so both stay in sync.
  const balanceQ = useQuery<number>(
    ['wallet', 'balance', userId],
    async () => {
      const r = await paymentService.getWalletBalance();
      return Number(r.data?.data?.balance ?? 0);
    },
    { staleTime: 15_000, ttl: CacheTTL.SHORT },
  );
  const walletBalance = balanceQ.data ?? null;
  // Insufficient only once we actually know the balance AND there's a real
  // amount to cover. Unknown balance / no amount → treat as usable so we
  // never wrongly block the user.
  const walletInsufficient =
    walletBalance != null && amount > 0 && walletBalance < amount;

  // Operator-enabled methods. Until loaded we optimistically show all; once
  // loaded we render only the enabled subset so a disabled method (which the
  // server would reject at booking time) never appears.
  const availableQ = useQuery<Array<{ type: PaymentMethodType }>>(
    ['available-methods'],
    async () => {
      const res = await paymentService.getAvailableMethods();
      return (res.data?.data ?? []) as Array<{ type: PaymentMethodType }>;
    },
    { staleTime: 5 * 60_000, ttl: CacheTTL.MEDIUM },
  );
  const enabledTypes = availableQ.data
    ? new Set(availableQ.data.map((m) => m.type))
    : null;
  const visibleStandard = enabledTypes
    ? STANDARD_OPTIONS.filter((o) => enabledTypes.has(o.type))
    : STANDARD_OPTIONS;

  const isDisabledType = (type: PaymentMethodType) =>
    type === 'wallet' && walletInsufficient;

  // Auto-select default once on first successful load.
  // Fallback: when the user has no saved methods (or no default flagged),
  // auto-pick Cash on Delivery. The booking server treats `cash` as the
  // implicit settlement when no payment_method_id is sent, so we surface
  // it explicitly here so the customer never sits on an empty selector.
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!methodsQ.data) return;
    if (selectedId) {
      // Rehydrated draft: only the id persisted, so re-emit the resolved
      // type — otherwise the parent's `payment_method` payload would fall
      // back to cash while the UI shows this selection. An id that no
      // longer resolves (saved method deleted since the draft was written)
      // falls through to the default/fallback pick below.
      const rehydrated =
        STANDARD_OPTIONS.find((o) => o.id === selectedId) ??
        methods.find((m) => m.id === selectedId);
      if (rehydrated) {
        autoSelectedRef.current = true;
        onSelectRef.current(selectedId, rehydrated.type);
        return;
      }
    }
    const def = methods.find((m) => m.is_default);
    if (def && !isDisabledType(def.type)) {
      autoSelectedRef.current = true;
      onSelectRef.current(def.id, def.type);
      return;
    }
    // No usable saved default — pick a sensible enabled option: prefer Cash
    // if it's offered, otherwise the first available non-disabled method.
    autoSelectedRef.current = true;
    const fallback =
      visibleStandard.find((o) => o.type === 'cash') ??
      visibleStandard.find((o) => !isDisabledType(o.type)) ??
      CASH_OPTION;
    onSelectRef.current(fallback.id, fallback.type);
  }, [methodsQ.data, selectedId, walletInsufficient]);

  const selectedStandard = STANDARD_OPTIONS.find((o) => o.id === selectedId);
  const selectedMethod = methods.find((m) => m.id === selectedId);
  const activeType = selectedStandard?.type ?? selectedMethod?.type;
  const activeBrand = selectedMethod?.card_brand;

  // If the wallet is the active pick but can no longer cover the amount,
  // move to a usable method so the user can't submit an unpayable booking.
  // Announced via toast — silently changing what the user will pay with
  // is how someone ends up owing cash to a runner they expected to pay
  // from balance.
  useEffect(() => {
    if (!walletInsufficient || activeType !== 'wallet') return;
    const fallback =
      visibleStandard.find((o) => o.type === 'cash') ??
      visibleStandard.find((o) => !isDisabledType(o.type)) ??
      CASH_OPTION;
    onSelectRef.current(fallback.id, fallback.type);
    toast.info(
      `Wallet balance can’t cover this booking — switched to ${fallback.label}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletInsufficient, activeType]);

  const activeLabel = selectedStandard?.label ?? selectedMethod?.label;
  const activeSub =
    activeType === 'wallet' && walletBalance != null
      ? `Balance ${formatCurrency(walletBalance)}`
      : selectedStandard?.description ??
        (selectedMethod?.last_four ? `••••${selectedMethod.last_four}` : undefined);

  const renderRow = (opt: {
    id: string;
    type: PaymentMethodType;
    label: string;
    sub?: string;
    brand?: string | null;
    isDefault?: boolean;
  }) => {
    const isSelected = selectedId === opt.id;
    const disabled = isDisabledType(opt.type);
    // Wallet rows show the live balance; when short, the row is disabled and
    // says so instead of showing the generic description.
    const sub =
      opt.type === 'wallet' && walletBalance != null
        ? disabled
          ? `Insufficient balance · ${formatCurrency(walletBalance)}`
          : `Balance ${formatCurrency(walletBalance)}`
        : opt.sub;

    return (
      <Pressable
        key={opt.id}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${opt.label}${sub ? `. ${sub}` : ''}`}
        accessibilityState={{ disabled, selected: isSelected }}
        className={`flex-row items-center rounded-xl px-2 py-3 ${isSelected ? 'bg-primaryLight' : ''}`}
        // Sheet-list rows take the flat surfaceMuted press wash, not the
        // card scale treatment.
        style={({ pressed }) =>
          pressed && !disabled
            ? { backgroundColor: LightColors.surfaceMuted }
            : null
        }
        android_ripple={
          disabled
            ? undefined
            : { color: `${LightColors.primary}14`, borderless: false }
        }
        onPress={() => {
          if (disabled) return;
          Haptics.selectionAsync().catch(() => {});
          onSelect(opt.id, opt.type);
          setShowSheet(false);
        }}
      >
        {/* Dim only the icon + label when disabled — the sub line carries
            the REASON ("Insufficient balance") and the inline recovery
            action (Top up) must stay tappable, so both keep full opacity.
            dangerDark, not danger: 12px status text needs the *Dark rung
            (base red is ~3.8:1 on white, and dimming it would halve that). */}
        <View className="flex-1 flex-row items-center">
          <PaymentBrandMark
            type={opt.type}
            brand={opt.brand}
            size={40}
            style={{ opacity: disabled ? 0.45 : 1 }}
          />
          <View className="flex-1 ml-3">
            <Text
              className="text-sm font-montserrat-bold text-textPrimary"
              style={disabled ? { opacity: 0.45 } : undefined}
            >
              {opt.label}
            </Text>
            {sub ? (
              <Text
                className="text-xs font-montserrat mt-0.5"
                style={{ color: disabled ? LightColors.dangerDark : LightColors.textSecondary }}
              >
                {sub}
              </Text>
            ) : null}
          </View>
        </View>
        {disabled && opt.type === 'wallet' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Top up wallet"
            hitSlop={12}
            className="py-2 pl-3 pr-1"
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              setShowSheet(false);
              // The booking draft persists, so this detour is lossless.
              router.push('/(customer)/wallet/top-up');
            }}
          >
            <Text className="text-[13px] font-montserrat-bold text-primary">
              Top up
            </Text>
          </Pressable>
        )}
        {isSelected && !disabled && <Check size={20} color={LightColors.primary} />}
        {opt.isDefault && !isSelected && !disabled && (
          <Text className="text-[10px] font-montserrat text-primary bg-surfaceMuted px-2 py-0.5 rounded">
            Default
          </Text>
        )}
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
        accessibilityLabel={`Payment method: ${activeLabel ?? 'none selected'}. Change`}
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
        {loading ? (
          // Spinner sits in the same 40pt slot as the method icon so the
          // trigger doesn't change height when the methods load.
          <View className="w-10 h-10 items-center justify-center">
            <Spinner size="small" color={LightColors.primary} />
          </View>
        ) : (
          <>
            {activeType ? (
              <PaymentBrandMark type={activeType} brand={activeBrand} size={40} />
            ) : (
              <View
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: LightColors.surfaceMuted }}
              />
            )}
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-bold text-textPrimary">
                {activeLabel ?? 'Select payment method'}
              </Text>
              {activeSub ? (
                <Text className="text-[11px] font-montserrat text-textSecondary">
                  {activeSub}
                </Text>
              ) : null}
            </View>
            <Text className="text-xs font-montserrat-bold text-primary">Change</Text>
          </>
        )}
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

          {/* Linked / saved methods (GCash/Maya/GrabPay via Xendit), shown
              first so one-tap methods are the top choice. */}
          {methods.map((item) =>
            renderRow({
              id: item.id,
              type: item.type,
              label: item.label,
              brand: item.card_brand,
              sub: item.last_four ? `••••${item.last_four}` : undefined,
              isDefault: item.is_default,
            }),
          )}

          {/* Hairline between the saved-methods group and the universal
              options so the two lists don't read as one. */}
          {methods.length > 0 && <View className="h-px bg-divider my-2" />}

          {/* Operator-enabled options. Online ones (GCash/Maya/Card) route
              through a secure Xendit checkout page at booking/top-up time. */}
          {visibleStandard.map((opt) =>
            renderRow({ id: opt.id, type: opt.type, label: opt.label, sub: opt.description }),
          )}
        </View>
      </BottomSheet>
    </View>
  );
}
