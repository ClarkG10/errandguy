import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ArrowLeft, Footprints, Bike, Truck, Car, MapPin, Clock, Route } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { PriceBreakdown } from '../../../components/ui/PriceBreakdown';
import {
  VehicleTypeSelector,
  type VehicleOption,
} from '../../../components/customer/VehicleTypeSelector';
import { PromoCodeInput } from '../../../components/customer/PromoCodeInput';
import { PaymentMethodSelector } from '../../../components/customer/PaymentMethodSelector';
import { OfferSlider } from '../../../components/customer/OfferSlider';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';
import { formatCurrency } from '../../../utils/formatCurrency';
import { getErrandTypeRule, type VehicleKey } from '../../../constants/errandTypeRules';
import { LightColors } from '../../../constants/colors';
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
  const [isEstimateLoading, setIsEstimateLoading] = useState(false);

  // Fetch estimate on mount — guarded against a stale-response race when
  // the user navigates back/forward quickly (the previous version could
  // commit a stale total to state after unmount).
  useEffect(() => {
    if (
      !draftBooking.errand_type_id ||
      draftBooking.pickup_lat == null ||
      draftBooking.pickup_lng == null
    ) {
      return;
    }
    let cancelled = false;
    setIsEstimateLoading(true);
    bookingService
      .getEstimate({
        errand_type_id: draftBooking.errand_type_id,
        pickup_lat: draftBooking.pickup_lat,
        pickup_lng: draftBooking.pickup_lng,
        dropoff_lat: draftBooking.dropoff_lat,
        dropoff_lng: draftBooking.dropoff_lng,
      })
      .then((res) => {
        if (cancelled) return;
        const data = res.data.data ?? null;
        setEstimate(data);
        // Only seed offer if the user hasn't already set one — never
        // overwrite their explicit choice with a server suggestion.
        if (data?.min_negotiate_fee && draftBooking.customer_offer == null) {
          setOfferPrice(data.min_negotiate_fee);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsEstimateLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // draftBooking.customer_offer intentionally excluded — including it
    // would refetch on every offer-slider movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftBooking.errand_type_id,
    draftBooking.pickup_lat,
    draftBooking.pickup_lng,
    draftBooking.dropoff_lat,
    draftBooking.dropoff_lng,
  ]);

  // Distance-based ETA per vehicle so the selector cards can preview
  // travel time alongside fare. Returns undefined for single-location
  // errands where distance isn't applicable.
  const etaFor = (key: string): string | undefined => {
    if (!estimate?.distance_km) return undefined;
    const speeds: Record<string, number> = {
      walk: 5,
      bicycle: 15,
      motorcycle: 35,
      car: 30,
    };
    const speed = speeds[key] ?? 30;
    const minutes = Math.round((estimate.distance_km / speed) * 60);
    if (minutes < 1) return '< 1 min';
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${minutes} min`;
  };

  const allVehicleOptions: VehicleOption[] = [
    {
      key: 'walk',
      label: 'Walk',
      icon: VEHICLE_ICONS.walk,
      perKm: 0,
      estimatedTotal: estimate?.walk?.total_amount ?? 0,
      eta: etaFor('walk'),
    },
    {
      key: 'bicycle',
      label: 'Bicycle',
      icon: VEHICLE_ICONS.bicycle,
      perKm: 0,
      estimatedTotal: estimate?.bicycle?.total_amount ?? 0,
      eta: etaFor('bicycle'),
    },
    {
      key: 'motorcycle',
      label: 'Motorcycle',
      icon: VEHICLE_ICONS.motorcycle,
      perKm: 0,
      estimatedTotal: estimate?.motorcycle?.total_amount ?? 0,
      eta: etaFor('motorcycle'),
    },
    {
      key: 'car',
      label: 'Car',
      icon: VEHICLE_ICONS.car,
      perKm: 0,
      estimatedTotal: estimate?.car?.total_amount ?? 0,
      eta: etaFor('car'),
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
    // Per-errand-type validation. Without these the server would 422 the
    // request after the user already tapped Confirm — slow + ugly.
    if (
      rule.descriptionRequired &&
      (!draftBooking.description || draftBooking.description.trim().length === 0)
    ) {
      toast.warning(`${rule.descriptionLabel} is required for this errand.`);
      return;
    }
    if (!rule.singleLocation && !draftBooking.dropoff_address) {
      toast.warning('Please add a drop-off location.');
      return;
    }
    if (
      rule.requiresShoppingBudget &&
      (draftBooking.shopping_budget == null || draftBooking.shopping_budget <= 0)
    ) {
      toast.warning('Please set a shopping budget for this errand.');
      return;
    }
    if (pricingMode === 'negotiate' && (!offerPrice || offerPrice <= 0)) {
      toast.warning('Please set an offer amount.');
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
        // Sentinel id used by the selector for cash-on-delivery — the
        // server has no real PaymentMethod row for cash, so we omit it.
        payment_method_id:
          draftBooking.payment_method_id === '__cash__'
            ? undefined
            : draftBooking.payment_method_id,
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
    rule,
    setActiveBooking,
    clearDraft,
    router,
  ]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Review & confirm" showBack fallbackHref="/(customer)/(tabs)">
        <View className="px-5 -mt-2 pb-3">
          <Text
            className="text-[10px] font-montserrat-bold uppercase"
            style={{ letterSpacing: 1.4, color: LightColors.textSecondary }}
          >
            New errand · Step 4
          </Text>
        </View>
      </GradientHeader>

      {/* Step indicator */}
      <View className="px-5 mt-3 pb-3">
        <BookingStepIndicator currentStep={3} />
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        {/* Route Summary — typographic, ride-hailing-style two-line
            stack with a connecting hairline. No icon-tile chips. */}
        <View className="mb-5 py-3 border-y border-divider">
          <View className="flex-row items-center mb-2.5">
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LightColors.primary }}
            />
            <View className="flex-1 ml-3">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.2 }}
              >
                Pickup
              </Text>
              <Text className="text-[14px] font-montserrat-semi text-textPrimary" numberOfLines={1}>
                {draftBooking.pickup_address ?? 'Pickup location'}
              </Text>
            </View>
          </View>
          <View
            style={{
              marginLeft: 3,
              width: 2,
              height: 12,
              backgroundColor: LightColors.divider,
            }}
          />
          <View className="flex-row items-center mt-2.5">
            <View
              style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: LightColors.ink }}
            />
            <View className="flex-1 ml-3">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.2 }}
              >
                Drop-off
              </Text>
              <Text className="text-[14px] font-montserrat-semi text-textPrimary" numberOfLines={1}>
                {draftBooking.dropoff_address ?? 'Drop-off location'}
              </Text>
            </View>
          </View>
        </View>

        {/* Distance & Time — inline typographic stat row, no chips. */}
        {estimate?.distance_km != null && (
          <View className="flex-row items-center mb-5" style={{ gap: 16 }}>
            <View className="flex-row items-center">
              <Route size={13} color={LightColors.textTertiary} strokeWidth={1.8} />
              <Text className="text-[12px] font-inter tabular-nums text-textSecondary ml-1.5">
                {estimate.distance_km.toFixed(1)} km
              </Text>
            </View>
            {getEstimatedTime() && (
              <View className="flex-row items-center">
                <Clock size={13} color={LightColors.textTertiary} strokeWidth={1.8} />
                <Text className="text-[12px] font-inter tabular-nums text-textSecondary ml-1.5">
                  ~{getEstimatedTime()}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Pricing Mode — underline tab strip (replaces the segmented
            pill so the screen carries one less rounded element). */}
        <View
          className="flex-row mb-5 border-b border-divider"
          accessibilityRole="tablist"
        >
          {(['fixed', 'negotiate'] as PricingMode[]).map((mode) => {
            const active = pricingMode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={mode === 'fixed' ? 'Fixed price mode' : 'Make an offer mode'}
                onPress={() => {
                  if (active) return;
                  Haptics.selectionAsync();
                  setPricingMode(mode);
                  updateDraft({ pricing_mode: mode });
                  if (
                    mode === 'negotiate' &&
                    estimate?.min_negotiate_fee &&
                    draftBooking.customer_offer == null
                  ) {
                    setOfferPrice(estimate.min_negotiate_fee);
                    updateDraft({ customer_offer: estimate.min_negotiate_fee });
                  }
                }}
                className="pr-5 pb-2.5 -mb-px"
                style={active ? { borderBottomWidth: 2, borderBottomColor: LightColors.primary } : undefined}
                hitSlop={6}
              >
                <Text
                  className={`text-[13px] ${
                    active
                      ? 'font-montserrat-bold text-textPrimary'
                      : 'font-montserrat-semi text-textSecondary'
                  }`}
                >
                  {mode === 'fixed' ? 'Fixed price' : 'Make an offer'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {pricingMode === 'fixed' ? (
          <>
            {/* Single-location errands (queue, bills_payment) have no
                travel distance, so vehicle pricing is identical for every
                option. Hide the selector to avoid the confusing "all
                vehicles cost the same" UX. */}
            {!rule.singleLocation && vehicleOptions.length > 1 && (
              <VehicleTypeSelector
                options={vehicleOptions}
                selectedKey={vehicleType}
                onSelect={(key) => {
                  setVehicleType(key);
                  updateDraft({ vehicle_type_rate: key });
                }}
              />
            )}

            {currentVehicleEstimate ? (
              <View className="mb-4">
                <PriceBreakdown
                  items={priceItems}
                  total={totalAmount}
                />
              </View>
            ) : (
              /* Estimate skeleton — sized to roughly match the real
                 PriceBreakdown so the CTA doesn't shift when the data
                 arrives. Pulses softly via opacity. */
              <View className="mb-4" accessibilityLabel="Calculating fare">
                {Array.from({ length: 3 }).map((_, i) => (
                  <View
                    key={`pb-skel-${i}`}
                    className="flex-row justify-between py-2"
                  >
                    <View
                      className="h-3 rounded-full bg-divider"
                      style={{ width: 90, opacity: 0.6 }}
                    />
                    <View
                      className="h-3 rounded-full bg-divider"
                      style={{ width: 60, opacity: 0.6 }}
                    />
                  </View>
                ))}
                <View className="border-t border-divider mt-1 pt-3 flex-row justify-between">
                  <View
                    className="h-4 rounded-full bg-divider"
                    style={{ width: 50, opacity: 0.7 }}
                  />
                  <View
                    className="h-4 rounded-full bg-divider"
                    style={{ width: 80, opacity: 0.7 }}
                  />
                </View>
              </View>
            )}
          </>
        ) : (
          <OfferSlider
            value={offerPrice}
            min={estimate?.min_negotiate_fee ?? 50}
            max={
              estimate?.recommended_max ??
              // Fallback when backend doesn't yet emit recommended_max:
              // 3x the most expensive vehicle estimate, floored at 1500.
              Math.max(
                ...vehicleOptions.map((v) => v.estimatedTotal ?? 0),
                500,
              ) * 3
            }
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
      <BottomActionBar>
        <Button
          title={
            pricingMode === 'fixed'
              ? isEstimateLoading || !currentVehicleEstimate
                ? 'Calculating fare…'
                : `Confirm ${formatCurrency(totalAmount)}`
              : `Send Offer ${formatCurrency(offerPrice)}`
          }
          onPress={handleSubmit}
          loading={isSubmitting}
          // Don't let the user submit a fixed-price booking before the
          // estimate has resolved — without it we'd be sending a
          // payload with an indeterminate price expectation, and the
          // server would 422 on `vehicle_type_rate` validation
          // mismatch.
          disabled={
            pricingMode === 'fixed' &&
            (isEstimateLoading || !currentVehicleEstimate)
          }
          fullWidth
        />
      </BottomActionBar>
    </View>
  );
}

const reviewStyles = StyleSheet.create({});
