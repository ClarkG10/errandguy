import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Footprints, Bike, Truck, Car, MapPin, Clock, Route } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { Button } from '../../../components/ui/Button';
import { PriceBreakdown } from '../../../components/ui/PriceBreakdown';
import {
  VehicleTypeSelector,
  type VehicleOption,
} from '../../../components/customer/VehicleTypeSelector';
import { PromoCodeInput } from '../../../components/customer/PromoCodeInput';
import { PaymentMethodSelector } from '../../../components/customer/PaymentMethodSelector';
import { OfferSlider } from '../../../components/customer/OfferSlider';
import { formatCurrency } from '../../../utils/formatCurrency';
import { getErrandTypeRule, type VehicleKey } from '../../../constants/errandTypeRules';
import type { PricingMode } from '../../../types';
import { toast } from '../../../stores/toastStore';

interface EstimateResult {
  walk?: { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  bicycle?: { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  motorcycle?: { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  car?: { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  distance_km?: number;
  min_negotiate_fee?: number;
  recommended_min?: number;
  recommended_max?: number;
}

const VEHICLE_ICONS: Record<string, LucideIcon> = {
  walk: Footprints,
  bicycle: Bike,
  motorcycle: Truck,
  car: Car,
};

export default function ReviewScreen() {
  const router = useRouter();
  const { draftBooking, updateDraft, setStep, clearDraft, setActiveBooking } =
    useBookingStore();

  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [pricingMode, setPricingMode] = useState<PricingMode>(
    draftBooking.pricing_mode ?? 'fixed',
  );

  // Per-errand-type rule (allowed vehicles, default vehicle, etc.)
  const rule = useMemo(
    () => getErrandTypeRule(draftBooking.errand_type_slug),
    [draftBooking.errand_type_slug],
  );

  const initialVehicle = useMemo<VehicleKey>(() => {
    const stored = draftBooking.vehicle_type_rate as VehicleKey | undefined;
    if (stored && rule.allowedVehicles.includes(stored)) return stored;
    return rule.defaultVehicle;
  }, [draftBooking.vehicle_type_rate, rule]);

  const [vehicleType, setVehicleType] = useState<string>(initialVehicle);

  // If the rule changes (e.g. user changed errand type) and the current
  // vehicle is no longer allowed, snap back to the rule's default.
  useEffect(() => {
    if (!rule.allowedVehicles.includes(vehicleType as VehicleKey)) {
      setVehicleType(rule.defaultVehicle);
      updateDraft({ vehicle_type_rate: rule.defaultVehicle });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule]);
  const [paymentMethodType, setPaymentMethodType] = useState<string | undefined>();
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [offerPrice, setOfferPrice] = useState(
    draftBooking.customer_offer ?? 100,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch estimate on mount
  useEffect(() => {
    if (
      draftBooking.errand_type_id &&
      draftBooking.pickup_lat != null &&
      draftBooking.pickup_lng != null
    ) {
      bookingService
        .getEstimate({
          errand_type_id: draftBooking.errand_type_id,
          pickup_lat: draftBooking.pickup_lat,
          pickup_lng: draftBooking.pickup_lng,
          dropoff_lat: draftBooking.dropoff_lat,
          dropoff_lng: draftBooking.dropoff_lng,
        })
        .then((res) => {
          setEstimate(res.data.data ?? null);
          if (res.data.data?.min_negotiate_fee) {
            setOfferPrice(res.data.data.min_negotiate_fee);
          }
        })
        .catch(() => {});
    }
  }, [draftBooking.errand_type_id, draftBooking.pickup_lat, draftBooking.pickup_lng, draftBooking.dropoff_lat, draftBooking.dropoff_lng]);

  const allVehicleOptions: VehicleOption[] = [
    {
      key: 'walk',
      label: 'Walk',
      icon: VEHICLE_ICONS.walk,
      perKm: 0,
      estimatedTotal: estimate?.walk?.total_amount ?? 0,
    },
    {
      key: 'bicycle',
      label: 'Bicycle',
      icon: VEHICLE_ICONS.bicycle,
      perKm: 0,
      estimatedTotal: estimate?.bicycle?.total_amount ?? 0,
    },
    {
      key: 'motorcycle',
      label: 'Motorcycle',
      icon: VEHICLE_ICONS.motorcycle,
      perKm: 0,
      estimatedTotal: estimate?.motorcycle?.total_amount ?? 0,
    },
    {
      key: 'car',
      label: 'Car',
      icon: VEHICLE_ICONS.car,
      perKm: 0,
      estimatedTotal: estimate?.car?.total_amount ?? 0,
    },
  ];

  // Hide vehicles this errand type doesn't support (e.g. walk/bicycle for transportation).
  const vehicleOptions = allVehicleOptions.filter((opt) =>
    rule.allowedVehicles.includes(opt.key as VehicleKey),
  );

  const currentVehicleEstimate = estimate?.[vehicleType as keyof EstimateResult] as
    | { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number }
    | undefined;

  const priceItems = currentVehicleEstimate
    ? [
        { label: 'Base Fee', amount: currentVehicleEstimate.base_fee ?? 0 },
        { label: 'Distance Fee', amount: currentVehicleEstimate.distance_fee ?? 0 },
        { label: 'Convenience Fee', amount: currentVehicleEstimate.service_fee ?? 0 },
        { label: 'Surcharge', amount: currentVehicleEstimate.surcharge ?? 0 },
        ...(promoDiscount > 0
          ? [{ label: 'Promo Discount', amount: -promoDiscount }]
          : []),
      ]
    : [];

  const totalAmount = currentVehicleEstimate
    ? (currentVehicleEstimate.total_amount ?? 0) - promoDiscount
    : 0;

  // Approximate travel time based on vehicle type and distance
  const getEstimatedTime = () => {
    if (!estimate?.distance_km) return null;
    const km = estimate.distance_km;
    const speeds: Record<string, number> = { walk: 5, bicycle: 15, motorcycle: 35, car: 30 };
    const speed = speeds[vehicleType] ?? 30;
    const minutes = Math.round((km / speed) * 60);
    if (minutes < 1) return '< 1 min';
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${minutes} min`;
  };

  const handleSubmit = useCallback(async () => {
    if (!draftBooking.errand_type_id || !draftBooking.pickup_address) {
      toast.warning('Please go back and complete all booking steps.');
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        errand_type_id: draftBooking.errand_type_id!,
        pickup_address: draftBooking.pickup_address!,
        pickup_lat: draftBooking.pickup_lat!,
        pickup_lng: draftBooking.pickup_lng!,
        pickup_contact_name: draftBooking.pickup_contact_name,
        pickup_contact_phone: draftBooking.pickup_contact_phone,
        dropoff_address: draftBooking.dropoff_address,
        dropoff_lat: draftBooking.dropoff_lat,
        dropoff_lng: draftBooking.dropoff_lng,
        dropoff_contact_name: draftBooking.dropoff_contact_name,
        dropoff_contact_phone: draftBooking.dropoff_contact_phone,
        description: draftBooking.description,
        special_instructions: draftBooking.special_instructions,
        estimated_item_value: draftBooking.estimated_item_value,
        shopping_budget: draftBooking.shopping_budget,
        pricing_mode: pricingMode,
        vehicle_type_rate: pricingMode === 'fixed' ? vehicleType : undefined,
        customer_offer: pricingMode === 'negotiate' ? offerPrice : undefined,
        schedule_type: draftBooking.schedule_type ?? ('now' as const),
        scheduled_at: draftBooking.scheduled_at,
        payment_method: paymentMethodType ?? 'cash',
        payment_method_id: draftBooking.payment_method_id,
        promo_code: draftBooking.promo_code,
      };

      const res = await bookingService.createBooking(payload);
      const booking = res.data.data;
      setActiveBooking(booking);
      clearDraft();
      router.replace(`/(customer)/book/confirm?bookingId=${booking.id}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create booking');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    draftBooking,
    pricingMode,
    vehicleType,
    offerPrice,
    paymentMethodType,
    setActiveBooking,
    clearDraft,
    router,
  ]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-3">
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(customer)/(tabs)')}
          className="w-9 h-9 rounded-xl bg-surface items-center justify-center mr-3"
        >
          <ArrowLeft size={18} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Review
        </Text>
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        {/* Route Summary */}
        <View className="mb-4">
          <View className="flex-row items-start mb-2.5">
            <View className="w-5 h-5 rounded-full bg-primary/10 items-center justify-center mt-0.5 mr-2.5">
              <MapPin size={11} color="#2563EB" />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-montserrat-semi text-textTertiary uppercase tracking-wider">Pickup</Text>
              <Text className="text-sm font-montserrat text-textPrimary" numberOfLines={1}>
                {draftBooking.pickup_address ?? 'Pickup location'}
              </Text>
            </View>
          </View>
          <View className="flex-row items-start">
            <View className="w-5 h-5 rounded-full bg-danger/10 items-center justify-center mt-0.5 mr-2.5">
              <MapPin size={11} color="#EF4444" />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-montserrat-semi text-textTertiary uppercase tracking-wider">Dropoff</Text>
              <Text className="text-sm font-montserrat text-textPrimary" numberOfLines={1}>
                {draftBooking.dropoff_address ?? 'Dropoff location'}
              </Text>
            </View>
          </View>
        </View>

        {/* Distance & Time Badges */}
        {estimate?.distance_km != null && (
          <View className="flex-row gap-3 mb-5">
            <View className="flex-row items-center bg-surface rounded-lg px-3 py-2">
              <Route size={14} color="#64748B" />
              <Text className="text-xs font-montserrat-semi text-textSecondary ml-1.5">
                {estimate.distance_km.toFixed(1)} km
              </Text>
            </View>
            {getEstimatedTime() && (
              <View className="flex-row items-center bg-surface rounded-lg px-3 py-2">
                <Clock size={14} color="#64748B" />
                <Text className="text-xs font-montserrat-semi text-textSecondary ml-1.5">
                  ~{getEstimatedTime()}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Pricing Mode Toggle */}
        <View className="bg-surface rounded-xl p-1 mb-4">
          <View className="flex-row">
            <Pressable
              className={`flex-1 py-2.5 rounded-lg items-center ${
                pricingMode === 'fixed' ? 'bg-primary' : ''
              }`}
              onPress={() => {
                setPricingMode('fixed');
                updateDraft({ pricing_mode: 'fixed' });
              }}
            >
              <Text
                className={`text-sm font-montserrat-semi ${
                  pricingMode === 'fixed' ? 'text-white' : 'text-textSecondary'
                }`}
              >
                Fixed Price
              </Text>
            </Pressable>
            <Pressable
              className={`flex-1 py-2.5 rounded-lg items-center ${
                pricingMode === 'negotiate' ? 'bg-primary' : ''
              }`}
              onPress={() => {
                setPricingMode('negotiate');
                updateDraft({ pricing_mode: 'negotiate' });
              }}
            >
              <Text
                className={`text-sm font-montserrat-semi ${
                  pricingMode === 'negotiate' ? 'text-white' : 'text-textSecondary'
                }`}
              >
                Make an Offer
              </Text>
            </Pressable>
          </View>
        </View>

        {pricingMode === 'fixed' ? (
          <>
            <VehicleTypeSelector
              options={vehicleOptions}
              selectedKey={vehicleType}
              onSelect={(key) => {
                setVehicleType(key);
                updateDraft({ vehicle_type_rate: key });
              }}
            />

            {currentVehicleEstimate && (
              <View className="mb-4">
                <PriceBreakdown
                  items={priceItems}
                  total={totalAmount}
                />
              </View>
            )}
          </>
        ) : (
          <OfferSlider
            value={offerPrice}
            min={estimate?.min_negotiate_fee ?? 50}
            max={estimate?.recommended_max ?? 500}
            recommendedMin={estimate?.recommended_min}
            recommendedMax={estimate?.recommended_max}
            onChange={(val) => {
              setOfferPrice(val);
              updateDraft({ customer_offer: val });
            }}
          />
        )}

        {/* Promo Code */}
        <PromoCodeInput
          appliedCode={draftBooking.promo_code}
          onApply={(code, discount) => {
            updateDraft({ promo_code: code });
            setPromoDiscount(discount);
          }}
          onRemove={() => {
            updateDraft({ promo_code: undefined });
            setPromoDiscount(0);
          }}
        />

        {/* Payment Method */}
        <PaymentMethodSelector
          selectedId={draftBooking.payment_method_id}
          onSelect={(id, type) => {
            updateDraft({ payment_method_id: id });
            setPaymentMethodType(type);
          }}
        />

        <View className="h-28" />
      </ScrollView>

      {/* Bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-background px-5 py-4 pb-8 border-t border-divider">
        <Button
          title={
            pricingMode === 'fixed'
              ? `Confirm ${totalAmount > 0 ? formatCurrency(totalAmount) : ''}`
              : `Send Offer ${formatCurrency(offerPrice)}`
          }
          onPress={handleSubmit}
          loading={isSubmitting}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}

const reviewStyles = StyleSheet.create({});
