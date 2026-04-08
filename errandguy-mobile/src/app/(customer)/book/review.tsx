import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, MapPin, ArrowRight, Footprints, Bike, Truck, Car } from 'lucide-react-native';
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
import type { PricingMode } from '../../../types';

const STEP_LABELS = ['Type', 'Details', 'Schedule', 'Review'];

interface EstimateResult {
  walk?: { total: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  bicycle?: { total: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  motorcycle?: { total: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  car?: { total: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
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
  const [vehicleType, setVehicleType] = useState<string>(
    draftBooking.vehicle_type_rate ?? 'motorcycle',
  );
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

  const vehicleOptions: VehicleOption[] = [
    {
      key: 'walk',
      label: 'Walk',
      icon: VEHICLE_ICONS.walk,
      perKm: 0,
      estimatedTotal: estimate?.walk?.total ?? 0,
    },
    {
      key: 'bicycle',
      label: 'Bicycle',
      icon: VEHICLE_ICONS.bicycle,
      perKm: 0,
      estimatedTotal: estimate?.bicycle?.total ?? 0,
    },
    {
      key: 'motorcycle',
      label: 'Motorcycle',
      icon: VEHICLE_ICONS.motorcycle,
      perKm: 0,
      estimatedTotal: estimate?.motorcycle?.total ?? 0,
    },
    {
      key: 'car',
      label: 'Car',
      icon: VEHICLE_ICONS.car,
      perKm: 0,
      estimatedTotal: estimate?.car?.total ?? 0,
    },
  ];

  const currentVehicleEstimate = estimate?.[vehicleType as keyof EstimateResult] as
    | { total: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number }
    | undefined;

  const priceItems = currentVehicleEstimate
    ? [
        { label: 'Base Fee', amount: currentVehicleEstimate.base_fee },
        { label: 'Distance Fee', amount: currentVehicleEstimate.distance_fee },
        { label: 'Service Fee', amount: currentVehicleEstimate.service_fee },
        { label: 'Surcharge', amount: currentVehicleEstimate.surcharge },
        ...(promoDiscount > 0
          ? [{ label: 'Promo Discount', amount: -promoDiscount }]
          : []),
      ]
    : [];

  const totalAmount = currentVehicleEstimate
    ? currentVehicleEstimate.total - promoDiscount
    : 0;

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const payload = {
        errand_type_id: draftBooking.errand_type_id!,
        pickup_address: draftBooking.pickup_address!,
        pickup_lat: draftBooking.pickup_lat!,
        pickup_lng: draftBooking.pickup_lng!,
        dropoff_address: draftBooking.dropoff_address,
        dropoff_lat: draftBooking.dropoff_lat,
        dropoff_lng: draftBooking.dropoff_lng,
        instructions: draftBooking.description,
        pricing_mode: pricingMode,
        schedule_type: draftBooking.schedule_type ?? ('now' as const),
        scheduled_at: draftBooking.scheduled_at,
        offered_price:
          pricingMode === 'negotiate' ? offerPrice : undefined,
        payment_method_id: draftBooking.payment_method_id,
      };

      const res = await bookingService.createBooking(payload);
      const booking = res.data.data;
      setActiveBooking(booking);
      clearDraft();
      router.replace(`/(customer)/book/confirm?bookingId=${booking.id}`);
    } catch (err: any) {
      Alert.alert(
        'Booking Error',
        err?.response?.data?.message ?? 'Failed to create booking',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    draftBooking,
    pricingMode,
    offerPrice,
    setActiveBooking,
    clearDraft,
    router,
  ]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          Review & Pay
        </Text>
      </View>

      {/* Step Indicator */}
      <View className="flex-row px-5 mb-4">
        {STEP_LABELS.map((label, i) => (
          <View key={label} className="flex-1 items-center">
            <View className="w-8 h-8 rounded-full items-center justify-center bg-primary">
              <Text className="text-xs font-montserrat-bold text-white">
                {i + 1}
              </Text>
            </View>
            <Text className="text-[10px] font-montserrat text-textSecondary mt-1">
              {label}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        {/* Route Summary */}
        <View className="bg-surface border border-divider rounded-xl p-4 mb-4">
          <View className="flex-row items-center mb-2">
            <MapPin size={14} color="#2563EB" />
            <Text
              className="text-sm font-montserrat text-textPrimary ml-2 flex-1"
              numberOfLines={1}
            >
              {draftBooking.pickup_address ?? 'Pickup'}
            </Text>
          </View>
          <View className="flex-row items-center">
            <MapPin size={14} color="#EF4444" />
            <Text
              className="text-sm font-montserrat text-textPrimary ml-2 flex-1"
              numberOfLines={1}
            >
              {draftBooking.dropoff_address ?? 'Dropoff'}
            </Text>
          </View>
          {estimate?.distance_km != null && (
            <Text className="text-xs font-montserrat text-textSecondary mt-2">
              Distance: {estimate.distance_km.toFixed(1)} km
            </Text>
          )}
        </View>

        {/* Pricing Mode Toggle */}
        <View className="flex-row bg-divider rounded-lg p-1 mb-4">
          <Pressable
            className={`flex-1 py-2 rounded-md items-center ${
              pricingMode === 'fixed' ? 'bg-surface' : ''
            }`}
            onPress={() => {
              setPricingMode('fixed');
              updateDraft({ pricing_mode: 'fixed' });
            }}
          >
            <Text
              className={`text-sm font-montserrat-bold ${
                pricingMode === 'fixed'
                  ? 'text-textPrimary'
                  : 'text-textSecondary'
              }`}
            >
              Fixed Price
            </Text>
          </Pressable>
          <Pressable
            className={`flex-1 py-2 rounded-md items-center ${
              pricingMode === 'negotiate' ? 'bg-surface' : ''
            }`}
            onPress={() => {
              setPricingMode('negotiate');
              updateDraft({ pricing_mode: 'negotiate' });
            }}
          >
            <Text
              className={`text-sm font-montserrat-bold ${
                pricingMode === 'negotiate'
                  ? 'text-textPrimary'
                  : 'text-textSecondary'
              }`}
            >
              Make an Offer
            </Text>
          </Pressable>
        </View>

        {pricingMode === 'fixed' ? (
          <>
            {/* Vehicle Type */}
            <VehicleTypeSelector
              options={vehicleOptions}
              selectedKey={vehicleType}
              onSelect={(key) => {
                setVehicleType(key);
                updateDraft({ vehicle_type_rate: key });
              }}
            />

            {/* Price Breakdown */}
            {currentVehicleEstimate && (
              <View className="bg-surface border border-divider rounded-xl p-4 mb-4">
                <PriceBreakdown
                  items={priceItems}
                  total={totalAmount}
                />
              </View>
            )}
          </>
        ) : (
          <>
            {/* Offer Slider */}
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
          </>
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
          onSelect={(id) => updateDraft({ payment_method_id: id })}
        />

        <View className="h-24" />
      </ScrollView>

      {/* Bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <Button
          title={
            pricingMode === 'fixed'
              ? `Confirm & Book ${totalAmount > 0 ? formatCurrency(totalAmount) : ''}`
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
