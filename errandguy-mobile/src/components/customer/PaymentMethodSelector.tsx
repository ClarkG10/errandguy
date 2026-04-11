import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { CreditCard, Wallet, Smartphone, X, Check, Banknote } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { paymentService } from '../../services/payment.service';
import type { PaymentMethod, PaymentMethodType } from '../../types';

interface PaymentMethodSelectorProps {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
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
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSheet, setShowSheet] = useState(false);

  useEffect(() => {
    paymentService
      .getPaymentMethods()
      .then((res) => {
        const data: PaymentMethod[] = res.data.data ?? [];
        setMethods(data);
        // Auto-select default if none selected
        if (!selectedId) {
          const defaultMethod = data.find((m) => m.is_default);
          if (defaultMethod) onSelect(defaultMethod.id);
        }
      })
      .catch(() => setMethods([]))
      .finally(() => setLoading(false));
  }, [selectedId, onSelect]);

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
                    onSelect(item.id);
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
