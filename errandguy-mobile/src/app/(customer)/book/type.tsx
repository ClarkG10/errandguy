import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Car } from 'lucide-react-native';
import {
  Package,
  ShoppingCart,
  UtensilsCrossed,
  FileText,
  Shirt,
  PenTool,
  Receipt,
  Users,
  ShoppingBag,
  Clipboard,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { configService } from '../../../services/config.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';
import { GradientHeader } from '../../../components/ui/GradientHeader';
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
  Receipt,
  Users,
  ShoppingBag,
  Clipboard,
};

export default function TypeSelectionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ preselected?: string }>();
  const { draftBooking, updateDraft, clearDraft, setStep } = useBookingStore();

  const [errandTypes, setErrandTypes] = useState<ErrandType[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    draftBooking.errand_type_id ?? params.preselected,
  );
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  // `preselected` should only seed the initial selection — once the user
  // taps another tile the prop must not yank them back. Track whether
  // we've already consumed it.
  const preselectAppliedRef = useRef<boolean>(
    !!(draftBooking.errand_type_id || params.preselected),
  );

  // SWR-style cache so repeat visits paint instantly from AsyncStorage
  // even on cold start, then revalidate in the background. Shares the
  // ['errand-types'] cache key with the customer home tile so a single
  // fetch warms both screens. The /errand-types endpoint already returns
  // active-only rows server-side.
  const errandTypesQ = useQuery<ErrandType[]>(
    ['errand-types'],
    async () => {
      const res = await configService.getErrandTypes();
      return (res.data?.data ?? []) as ErrandType[];
    },
    { staleTime: 60 * 60 * 1000, ttl: CacheTTL.STATIC },
  );

  // Mirror the query result into local state so the existing render
  // pipeline (which reads `errandTypes`) stays untouched.
  useEffect(() => {
    if (errandTypesQ.data) setErrandTypes(errandTypesQ.data);
  }, [errandTypesQ.data]);
  useEffect(() => {
    if (errandTypesQ.error) {
      toast.error('Failed to load errand types. Please try again.');
    }
  }, [errandTypesQ.error]);
  const loadingTypes = errandTypesQ.loading && errandTypes.length === 0;

  useEffect(() => {
    if (preselectAppliedRef.current) return;
    if (params.preselected && !draftBooking.errand_type_id) {
      setSelectedId(params.preselected);
      preselectAppliedRef.current = true;
    }
  }, [params.preselected, draftBooking.errand_type_id]);

  // True if the user has any meaningful draft data — used to decide
  // whether the back button should silently leave or prompt to discard.
  const hasDraftData = !!(
    draftBooking.errand_type_id ||
    draftBooking.pickup_address ||
    draftBooking.dropoff_address ||
    draftBooking.description ||
    (draftBooking.item_photos?.length ?? 0) > 0
  );

  const leaveFlow = useCallback(() => {
    clearDraft();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(customer)/(tabs)');
    }
  }, [clearDraft, router]);

  const handleBackPress = useCallback(() => {
    if (hasDraftData) {
      setShowDiscardModal(true);
    } else {
      leaveFlow();
    }
  }, [hasDraftData, leaveFlow]);

  const handleContinue = useCallback(() => {
    if (!selectedId) return;
    const selectedType = errandTypes.find((t) => t.id === selectedId);
    // If errand type changed, drop ONLY the fields that are tied to the
    // previous service shape — pricing/vehicle/offer plus shopping
    // metadata. We deliberately keep pickup/dropoff coords, address text,
    // contact info, and photos because those are reusable and re-typing
    // them is the single most painful part of the flow. The
    // rule-cleanup effect on details.tsx will additionally prune
    // incompatible fields (e.g. dropoff for single-location errands).
    if (
      draftBooking.errand_type_id &&
      draftBooking.errand_type_id !== selectedId
    ) {
      updateDraft({
        vehicle_type_rate: undefined,
        customer_offer: undefined,
        pricing_mode: undefined,
        shopping_budget: undefined,
        estimated_item_value: undefined,
      });
    }
    updateDraft({
      errand_type_id: selectedId,
      errand_type_slug: selectedType?.slug,
    });
    setStep(1);
    router.push('/(customer)/book/details');
  }, [selectedId, errandTypes, draftBooking.errand_type_id, updateDraft, setStep, router]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="What do you need?" showBack fallbackHref="/(customer)/(tabs)">
        <View className="px-5 -mt-2 pb-3">
          <Text
            className="text-[10px] font-montserrat-bold uppercase"
            style={{ letterSpacing: 1.4, color: 'rgba(255,255,255,0.78)' }}
          >
            New errand · Step 1
          </Text>
        </View>
      </GradientHeader>

      {/* Step indicator — makes the 4-step funnel visible from step 1
          (previously this screen had no indicator at all). */}
      <View className="px-5 mt-3 mb-3">
        <BookingStepIndicator currentStep={0} />
      </View>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={errandTypesQ.loading && errandTypes.length > 0}
            onRefresh={() => errandTypesQ.refresh()}
            tintColor="#2563EB"
            colors={['#2563EB']}
          />
        }
      >
        {loadingTypes && errandTypes.length === 0 ? (
          <View className="flex-row flex-wrap justify-between">
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={`skeleton-${i}`}
                className="w-[48%] mb-3 p-4 bg-surface"
                style={{ height: 148, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', opacity: 0.6 }}
              >
                <View className="w-11 h-11 rounded-xl bg-divider mb-3" />
                <View className="h-3 w-3/4 rounded-full bg-divider mb-2" />
                <View className="h-2 w-full rounded-full bg-divider mb-1.5" />
                <View className="h-2 w-1/2 rounded-full bg-divider" />
              </View>
            ))}
          </View>
        ) : (
        <View className="flex-row flex-wrap justify-between">
          {errandTypes.map((type) => {
            const Icon = ICON_MAP[type.icon_name] ?? Package;
            const isSelected = selectedId === type.id;
            const isTransportation = type.slug === 'transportation';

            return (
              <Pressable
                key={type.id}
                accessibilityRole="button"
                accessibilityLabel={`${type.name}. ${type.description ?? ''}`}
                accessibilityState={{ selected: isSelected }}
                // 12px corners (was 2xl/16) so tiles read more like cards
                // less like pills. Selected state replaces the tinted
                // bg+border combo with a solid 2px primary border on a
                // surface background — cleaner, no color-fill
                // duplication with the icon and label colors.
                className="w-[48%] mb-3 p-4 bg-surface"
                style={({ pressed }) => [
                  {
                    borderRadius: 12,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? '#2563EB' : '#E2E8F0',
                  },
                  pressed ? { opacity: 0.92, transform: [{ scale: 0.985 }] } : null,
                ]}
                android_ripple={{ color: 'rgba(37,99,235,0.08)', borderless: false }}
                onPress={() => setSelectedId(type.id)}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <Icon
                    size={22}
                    color={isSelected ? '#2563EB' : '#475569'}
                    strokeWidth={1.6}
                  />
                  {isTransportation && (
                    <Text className="text-[10px] font-montserrat-bold uppercase text-warning" style={{ letterSpacing: 1.2 }}>
                      Ride
                    </Text>
                  )}
                </View>
                <Text
                  className={`text-[14px] font-montserrat-bold mb-1 ${
                    isSelected ? 'text-primary' : 'text-textPrimary'
                  }`}
                >
                  {type.name}
                </Text>
                <Text
                  className="text-[11px] font-montserrat text-textSecondary mb-3 leading-[14px]"
                  numberOfLines={2}
                >
                  {type.description}
                </Text>
                <Text className="text-[11px] font-inter tabular-nums text-textMuted">
                  From {formatCurrency(type.base_fee)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        )}
        {!loadingTypes && errandTypes.length === 0 && (
          <View className="items-center py-16">
            <ActivityIndicator size="small" color="#94A3B8" />
            <Text className="mt-3 text-sm font-montserrat text-textTertiary text-center">
              No errand types available right now.{'\n'}Pull down or tap back to retry.
            </Text>
          </View>
        )}
        <View className="h-24" />
      </ScrollView>

      {/* Bottom CTA */}
      <BottomActionBar
        divider={false}
        style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 4 }}
      >
        <Button
          title="Continue"
          onPress={handleContinue}
          disabled={!selectedId}
          fullWidth
        />
      </BottomActionBar>

      <ConfirmModal
        visible={showDiscardModal}
        title="Discard this booking?"
        message="You'll lose the details you've entered so far."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setShowDiscardModal(false);
          leaveFlow();
        }}
        onCancel={() => setShowDiscardModal(false)}
      />
    </View>
  );
}
