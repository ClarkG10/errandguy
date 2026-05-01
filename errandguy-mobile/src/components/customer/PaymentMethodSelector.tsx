import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { CreditCard, Wallet, Smartphone, X, Check, Banknote } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { paymentService } from '../../services/payment.service';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { useAuthStore } from '../../stores/authStore';
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
    }
  }, [methodsQ.data, selectedId]);

  const selectedMethod = methods.find((m) => m.id === selectedId);
  const Icon = selectedMethod
    ? METHOD_ICONS[selectedMethod.type] ?? CreditCard
    : CreditCard;

  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Payment Method
      </Text>
      <Pressable
        className="flex-row items-center border border-divider rounded-lg px-4 py-3 bg-surface"
        onPress={() => setShowSheet(true)}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#2563EB" />
        ) : selectedMethod ? (
          <>
            <Icon size={20} color="#2563EB" />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {selectedMethod.label}
              </Text>
              {selectedMethod.last_four && (
                <Text className="text-xs font-montserrat text-textSecondary">
                  ••••{selectedMethod.last_four}
                </Text>
              )}
            </View>
            <Text className="text-xs font-montserrat text-primary">
              Change
            </Text>
          </>
        ) : (
          <>
            <CreditCard size={20} color="#94A3B8" />
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
              <X size={24} color="#475569" />
            </Pressable>
          </View>

          {methods.length === 0 ? (
            <Text className="text-sm font-montserrat text-textSecondary text-center py-6">
              No payment methods available
            </Text>
          ) : (
            methods.map((item) => {
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
                  <MethodIcon size={20} color="#2563EB" />
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
                  {isSelected && <Check size={20} color="#2563EB" />}
                  {item.is_default && !isSelected && (
                    <Text className="text-[10px] font-montserrat text-primary bg-primaryLight px-2 py-0.5 rounded">
                      Default
                    </Text>
                  )}
                </Pressable>
              );
            })
          )}
        </View>
      </BottomSheet>
    </View>
  );
}
