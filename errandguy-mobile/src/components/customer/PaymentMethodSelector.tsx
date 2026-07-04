import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { CreditCard, Wallet, Smartphone, X, Check, Banknote } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { paymentService } from '../../services/payment.service';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { useAuthStore } from '../../stores/authStore';
import { LightColors } from '../../constants/colors';
import type { PaymentMethod, PaymentMethodType } from '../../types';

interface PaymentMethodSelectorProps {
  selectedId: string | undefined;
  onSelect: (id: string, type: PaymentMethodType) => void;
}

const METHOD_ICONS: Record<PaymentMethodType, LucideIcon> = {
  card: CreditCard,
  gcash: Smartphone,
  maya: Smartphone,
  wallet: Wallet,
  cash: Banknote,
};

// Synthetic "cash" entry. Backend accepts `payment_method: 'cash'` with
// no `payment_method_id`, so we sentinel the id locally and the booking
// payload simply omits the id field when this is the selection.
const CASH_OPTION = {
  id: '__cash__',
  type: 'cash' as PaymentMethodType,
  label: 'Cash on Delivery',
  description: 'Pay your runner directly when the errand is complete',
};

export function PaymentMethodSelector({
  selectedId,
  onSelect,
}: PaymentMethodSelectorProps) {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
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

  const methods = methodsQ.data ?? [];
  const loading = methodsQ.loading && !methodsQ.data;

  // Auto-select default once on first successful load.
  // Fallback: when the user has no saved methods (or no default flagged),
  // auto-pick Cash on Delivery. The booking server treats `cash` as the
  // implicit settlement when no payment_method_id is sent, so we surface
  // it explicitly here so the customer never sits on an empty selector.
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!methodsQ.data) return;
    if (selectedId) {
      autoSelectedRef.current = true;
      return;
    }
    const def = methodsQ.data.find((m) => m.is_default);
    if (def) {
      autoSelectedRef.current = true;
      onSelectRef.current(def.id, def.type);
      return;
    }
    // No default — fall back to Cash on Delivery.
    autoSelectedRef.current = true;
    onSelectRef.current(CASH_OPTION.id, CASH_OPTION.type);
  }, [methodsQ.data, selectedId]);

  const selectedMethod = methods.find((m) => m.id === selectedId);
  const isCashSelected = selectedId === CASH_OPTION.id;
  const Icon = isCashSelected
    ? Banknote
    : selectedMethod
      ? METHOD_ICONS[selectedMethod.type] ?? CreditCard
      : CreditCard;

  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Payment Method
      </Text>
      <Pressable
        className="flex-row items-center border border-divider rounded-xl px-4 py-3.5 bg-surface"
        onPress={() => setShowSheet(true)}
      >
        {loading ? (
          <ActivityIndicator size="small" color={LightColors.primary} />
        ) : isCashSelected ? (
          <>
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: LightColors.successLight }}
            >
              <Banknote size={20} color={LightColors.success} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-bold text-textPrimary">
                {CASH_OPTION.label}
              </Text>
              <Text className="text-[11px] font-montserrat text-textSecondary">
                Pay on delivery
              </Text>
            </View>
            <Text className="text-xs font-montserrat-bold text-primary">
              Change
            </Text>
          </>
        ) : selectedMethod ? (
          <>
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: LightColors.primaryLight }}
            >
              <Icon size={20} color={LightColors.primary} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-bold text-textPrimary">
                {selectedMethod.label}
              </Text>
              {selectedMethod.last_four && (
                <Text className="text-[11px] font-montserrat text-textSecondary">
                  ••••{selectedMethod.last_four}
                </Text>
              )}
            </View>
            <Text className="text-xs font-montserrat-bold text-primary">
              Change
            </Text>
          </>
        ) : (
          <>
            <CreditCard size={20} color={LightColors.textMuted} />
            <Text className="text-sm font-montserrat text-textSecondary ml-3 flex-1">
              Select payment method
            </Text>
          </>
        )}
      </Pressable>

      <BottomSheet
        isVisible={showSheet}
        onClose={() => setShowSheet(false)}
        snapPoints={[0.5]}
      >
        <View className="px-5 pb-6">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg font-montserrat-bold text-textPrimary">
              Payment Methods
            </Text>
            <Pressable onPress={() => setShowSheet(false)}>
              <X size={24} color={LightColors.textSecondary} />
            </Pressable>
          </View>

          {methods.length === 0 ? (
            <Text className="text-xs font-montserrat text-textSecondary text-center pb-3">
              You haven't added any cards or wallets yet.
            </Text>
          ) : null}
          {methods.map((item) => {
              const MethodIcon = METHOD_ICONS[item.type] ?? CreditCard;
              const isSelected = selectedId === item.id;
              return (
                <Pressable
                  key={item.id}
                  className={`flex-row items-center border-b border-divider py-3 ${
                    isSelected ? 'bg-primaryLight/30' : ''
                  }`}
                  onPress={() => {
                    onSelect(item.id, item.type);
                    setShowSheet(false);
                  }}
                >
                  <MethodIcon size={20} color={LightColors.primary} />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm font-montserrat-bold text-textPrimary">
                      {item.label}
                    </Text>
                    {item.last_four && (
                      <Text className="text-xs font-montserrat text-textSecondary">
                        ••••{item.last_four}
                      </Text>
                    )}
                  </View>
                  {isSelected && <Check size={20} color={LightColors.primary} />}
                  {item.is_default && !isSelected && (
                    <Text className="text-[10px] font-montserrat text-primary bg-primaryLight px-2 py-0.5 rounded">
                      Default
                    </Text>
                  )}
                </Pressable>
              );
            })}

          {/* Cash on Delivery — always available as a final fallback. */}
          <Pressable
            className={`flex-row items-center py-3 ${
              selectedId === CASH_OPTION.id ? 'bg-primaryLight/30' : ''
            }`}
            onPress={() => {
              onSelect(CASH_OPTION.id, CASH_OPTION.type);
              setShowSheet(false);
            }}
          >
            <View
              className="w-9 h-9 rounded-full items-center justify-center"
              style={{ backgroundColor: LightColors.successLight }}
            >
              <Banknote size={18} color={LightColors.success} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {CASH_OPTION.label}
              </Text>
              <Text className="text-xs font-montserrat text-textSecondary">
                {CASH_OPTION.description}
              </Text>
            </View>
            {selectedId === CASH_OPTION.id && <Check size={20} color={LightColors.primary} />}
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}
