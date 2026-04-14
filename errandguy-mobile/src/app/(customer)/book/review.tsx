import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, MapPin, ArrowRight, Footprints, Bike, Truck, Car, CircleDot, Navigation } from 'lucide-react-native';
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
    if (!draftBooking.errand_type_id || !draftBooking.pickup_address) {
      Alert.alert('Missing Info', 'Please go back and complete all booking steps.');
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
          className="w-10 h-10 rounded-full bg-surface items-center justify-center mr-3"
          style={reviewStyles.shadow}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-semi text-textPrimary flex-1">
          Review Booking
        </Text>
      </View>

      {/* Step Progress Bar */}
      <View className="flex-row items-center px-5 mb-4">
        {STEP_LABELS.map((label, i) => (
          <React.Fragment key={label}>
            <View className="items-center">
              <View
                className={`w-7 h-7 rounded-full items-center justify-center ${
                  i <= 3 ? 'bg-primary' : 'bg-divider'
                }`}
              >
                <Text className="text-[10px] font-montserrat-bold text-white">
                  {i + 1}
                </Text>
              </View>
              <Text className="text-[9px] font-montserrat text-textSecondary mt-1">
                {label}
              </Text>
            </View>
            {i < STEP_LABELS.length - 1 && (
              <View className={`flex-1 h-0.5 mx-1 mt-[-8px] ${i < 3 ? 'bg-primary' : 'bg-divider'}`} />
            )}
          </React.Fragment>
        ))}
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        {/* Route Card */}
        <View className="bg-surface rounded-2xl p-4 mb-4" style={reviewStyles.shadow}>
          <View className="flex-row">
            {/* Route dots */}
            <View className="items-center mr-3 pt-0.5">
              <CircleDot size={14} color="#2563EB" />
              <View className="w-0.5 h-6 bg-divider my-1" />
              <Navigation size={14} color="#EF4444" />
            </View>
            {/* Addresses */}
            <View className="flex-1">
              <View className="mb-3">
                <Text className="text-[10px] font-montserrat-semi text-primary mb-0.5">
                  PICKUP
                </Text>
                <Text className="text-sm font-montserrat text-textPrimary" numberOfLines={2}>
                  {draftBooking.pickup_address ?? 'Pickup location'}
                </Text>
              </View>
              <View>
                <Text className="text-[10px] font-montserrat-semi text-danger mb-0.5">
                  DROPOFF
                </Text>
                <Text className="text-sm font-montserrat text-textPrimary" numberOfLines={2}>
                  {draftBooking.dropoff_address ?? 'Dropoff location'}
                </Text>
              </View>
            </View>
          </View>
          {estimate?.distance_km != null && (
            <View className="mt-3 pt-3 border-t border-divider">
              <Text className="text-xs font-montserrat-semi text-textSecondary">
                Estimated Distance: {estimate.distance_km.toFixed(1)} km
              </Text>
            </View>
          )}
        </View>

        {/* Pricing Mode Toggle */}
        <View className="bg-surface rounded-2xl p-1.5 mb-4" style={reviewStyles.shadow}>
          <View className="flex-row">
            <Pressable
              className={`flex-1 py-2.5 rounded-xl items-center ${
                pricingMode === 'fixed' ? 'bg-primary' : ''
              }`}
              onPress={() => {
                setPricingMode('fixed');
                updateDraft({ pricing_mode: 'fixed' });
              }}
            >
              <Text
                className={`text-sm font-montserrat-bold ${
                  pricingMode === 'fixed' ? 'text-white' : 'text-textSecondary'
                }`}
              >
                Fixed Price
              </Text>
            </Pressable>
            <Pressable
              className={`flex-1 py-2.5 rounded-xl items-center ${
                pricingMode === 'negotiate' ? 'bg-primary' : ''
              }`}
              onPress={() => {
                setPricingMode('negotiate');
                updateDraft({ pricing_mode: 'negotiate' });
              }}
            >
              <Text
                className={`text-sm font-montserrat-bold ${
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
              <View className="bg-surface rounded-2xl p-4 mb-4" style={reviewStyles.shadow}>
                <Text className="text-sm font-montserrat-semi text-textPrimary mb-3">
                  Price Breakdown
                </Text>
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
          onSelect={(id, type) => {
            updateDraft({ payment_method_id: id });
            setPaymentMethodType(type);
          }}
        />

        <View className="h-28" />
      </ScrollView>

      {/* Bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-surface px-5 py-4 pb-8" style={reviewStyles.bottomShadow}>
        <Button
          title={
            pricingMode === 'fixed'
              ? `Confirm Booking ${totalAmount > 0 ? formatCurrency(totalAmount) : ''}`
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

const reviewStyles = StyleSheet.create({
  shadow: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  bottomShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
});
