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
import { toast } from '../../../stores/toastStore';

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
  const { draftBooking, updateDraft, clearDraft, setStep } = useBookingStore();

  const [errandTypes, setErrandTypes] = useState<ErrandType[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    draftBooking.errand_type_id ?? params.preselected,
  );

  useEffect(() => {
    configService.getErrandTypes().then((res) => {
      const types: ErrandType[] = res.data.data ?? [];
      setErrandTypes(types.filter((t) => t.is_active));
    }).catch(() => {
      toast.error('Failed to load errand types. Please try again.');
    });
  }, []);

  useEffect(() => {
    if (params.preselected && !draftBooking.errand_type_id) {
      setSelectedId(params.preselected);
    }
  }, [params.preselected, draftBooking.errand_type_id]);

  const handleContinue = useCallback(() => {
    if (!selectedId) return;
    // If errand type changed, reset the rest of the draft
    if (draftBooking.errand_type_id && draftBooking.errand_type_id !== selectedId) {
      clearDraft();
    }
    updateDraft({ errand_type_id: selectedId });
    setStep(1);
    router.push('/(customer)/book/details');
  }, [selectedId, draftBooking.errand_type_id, updateDraft, clearDraft, setStep, router]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4">
        <Pressable
          onPress={() => {
            clearDraft();
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(customer)/(tabs)');
            }
          }}
          className="mr-3 w-9 h-9 rounded-xl bg-surface items-center justify-center"
          style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-semi text-textPrimary">
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
                className={`w-[48%] mb-3 rounded-2xl p-4 ${
                  isSelected
                    ? 'bg-primary50 border-2 border-primary'
                    : 'bg-surface'
                }`}
                style={!isSelected ? { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 } : undefined}
                onPress={() => setSelectedId(type.id)}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <View className={`w-11 h-11 rounded-xl items-center justify-center ${isSelected ? 'bg-primary' : 'bg-primary50'}`}>
                    <Icon
                      size={20}
                      color={isSelected ? '#FFFFFF' : '#2563EB'}
                      strokeWidth={1.8}
                    />
                  </View>
                  {isTransportation && (
                    <Badge label="Ride" variant="primary" size="sm" />
                  )}
                </View>
                <Text
                  className={`text-sm font-montserrat-semi mb-1 ${
                    isSelected ? 'text-primary' : 'text-textPrimary'
                  }`}
                >
                  {type.name}
                </Text>
                <Text
                  className="text-xs font-montserrat text-textTertiary mb-2"
                  numberOfLines={2}
                >
                  {type.description}
                </Text>
                <Text className="text-xs font-montserrat-semi text-textTertiary">
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
      <View className="absolute bottom-0 left-0 right-0 bg-background px-5 py-4 pb-8" style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 4 }}>
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
