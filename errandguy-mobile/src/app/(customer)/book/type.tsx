import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Car } from 'lucide-react-native';
import {
  Package,
  ShoppingCart,
  UtensilsCrossed,
  FileText,
  Shirt,
  PenTool,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { configService } from '../../../services/config.service';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { formatCurrency } from '../../../utils/formatCurrency';
import type { ErrandType } from '../../../types';

const ICON_MAP: Record<string, LucideIcon> = {
  Package,
  ShoppingCart,
  UtensilsCrossed,
  FileText,
  Shirt,
  Car,
  PenTool,
};

export default function TypeSelectionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ preselected?: string }>();
  const { draftBooking, updateDraft, setStep } = useBookingStore();

  const [errandTypes, setErrandTypes] = useState<ErrandType[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    draftBooking.errand_type_id ?? params.preselected,
  );

  useEffect(() => {
    configService.getErrandTypes().then((res) => {
      const types: ErrandType[] = res.data.data ?? [];
      setErrandTypes(types.filter((t) => t.is_active));
    });
  }, []);

  useEffect(() => {
    if (params.preselected && !draftBooking.errand_type_id) {
      setSelectedId(params.preselected);
    }
  }, [params.preselected, draftBooking.errand_type_id]);

  const handleContinue = useCallback(() => {
    if (!selectedId) return;
    updateDraft({ errand_type_id: selectedId });
    setStep(1);
    router.push('/(customer)/book/details');
  }, [selectedId, updateDraft, setStep, router]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          What do you need?
        </Text>
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap justify-between">
          {errandTypes.map((type) => {
            const Icon = ICON_MAP[type.icon_name] ?? Package;
            const isSelected = selectedId === type.id;
            const isTransportation = type.slug === 'transportation';

            return (
              <Pressable
                key={type.id}
                className={`w-[48%] mb-4 rounded-xl border p-4 ${
                  isSelected
                    ? 'bg-primaryLight border-primary'
                    : 'bg-surface border-divider'
                }`}
                onPress={() => setSelectedId(type.id)}
              >
                <View className="flex-row items-center justify-between mb-2">
                  <Icon
                    size={28}
                    color={isSelected ? '#2563EB' : '#475569'}
                  />
                  {isTransportation && (
                    <Badge label="Ride" variant="primary" size="sm" />
                  )}
                </View>
                <Text
                  className={`text-sm font-montserrat-bold mb-1 ${
                    isSelected ? 'text-primary' : 'text-textPrimary'
                  }`}
                >
                  {type.name}
                </Text>
                <Text
                  className="text-xs font-montserrat text-textSecondary mb-2"
                  numberOfLines={2}
                >
                  {type.description}
                </Text>
                <Text className="text-xs font-montserrat text-textSecondary">
                  From {formatCurrency(type.base_fee)}
                </Text>
                {isTransportation && (
                  <Text className="text-[10px] font-montserrat text-warning mt-1">
                    PIN verification required
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
        <View className="h-24" />
      </ScrollView>

      {/* Bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <Button
          title="Continue"
          onPress={handleContinue}
          disabled={!selectedId}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}
