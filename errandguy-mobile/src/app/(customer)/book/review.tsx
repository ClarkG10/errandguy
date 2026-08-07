import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Clock, Route } from 'lucide-react-native';
import dayjs from 'dayjs';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { routeService } from '../../../services/route.service';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { PriceBreakdown } from '../../../components/ui/PriceBreakdown';
import { ErrorState } from '../../../components/ui/ErrorState';
import {
  VehicleTypeSelector,
  type VehicleOption,
} from '../../../components/customer/VehicleTypeSelector';
import { PromoCodeInput } from '../../../components/customer/PromoCodeInput';
import {
  PaymentMethodSelector,
  resolvePaymentMethodType,
} from '../../../components/customer/PaymentMethodSelector';
import { OfferSlider } from '../../../components/customer/OfferSlider';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';
import { formatCurrency } from '../../../utils/formatCurrency';
import { serializeChecklist } from '../../../utils/shoppingChecklist';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../../../utils/browser';
import { PaymentProgress } from '../../../components/ui/PaymentProgress';
import {
  BookingProgress,
  type BookingStage,
} from '../../../components/customer/BookingProgress';
import { usePaymentStore, isAttemptActive } from '../../../stores/paymentStore';
import { usePaymentVerification } from '../../../hooks/usePaymentVerification';
import { mapFailureReason } from '../../../utils/paymentErrors';
import { getErrandTypeRule, type VehicleKey } from '../../../constants/errandTypeRules';
import { useResponsive } from '../../../constants/responsive';
import { LightColors } from '../../../constants/colors';
import type { PaymentMethodType, PricingMode } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { haptics } from '../../../utils/haptics';


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

export default function ReviewScreen() {
  const router = useRouter();
  const { contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
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
  // Saved (tokenised) methods can't be resolved from the id alone — their
  // type arrives via the selector's onSelect once the methods list loads.
  const [savedMethodType, setSavedMethodType] = useState<
    PaymentMethodType | undefined
  >();
  // Sentinel ids ('__gcash__' etc.) resolve statically from the persisted
  // draft id, so the submitted `payment_method` always matches the visible
  // selection — including a rehydrated draft where no onSelect has fired
  // yet. Callback-captured state alone silently booked those as cash.
  const paymentMethodType =
    resolvePaymentMethodType(draftBooking.payment_method_id) ?? savedMethodType;
  // Persisted alongside promo_code so a remount can't show an applied chip
  // over an undiscounted total (while still submitting the code).
  const promoDiscount = draftBooking.promo_discount ?? 0;
  const [offerPrice, setOfferPrice] = useState(
    draftBooking.customer_offer ?? 100,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Drives the full-screen create overlay (BookingProgress) through the real
  // submit checkpoints, so the ~5-7s create round-trip shows staged progress
  // instead of a lone button spinner. Hands off to PaymentProgress for online
  // payments once the gateway verification begins.
  const [bookingStage, setBookingStage] = useState<BookingStage | null>(null);

  // ── Money-safety: idempotent attempt + honest verification ──────────────
  const beginAttempt = usePaymentStore((s) => s.beginAttempt);
  const linkPayment = usePaymentStore((s) => s.linkPayment);
  const setAttemptStatus = usePaymentStore((s) => s.setStatus);
  const resolveAttempt = usePaymentStore((s) => s.resolve);
  // Mounts the background poller and gives us the honest stage to render.
  const { attempt, stage: verifyStage, isOffline } = usePaymentVerification();
  // Synchronous re-entrancy latch — closes the double-tap window before the
  // Button's `loading` disable lands a render later.
  const submitLatch = useRef(false);
  const [isEstimateLoading, setIsEstimateLoading] = useState(false);
  // True when the estimate request failed — drives the inline retry UI.
  // Without it a failed fetch left the screen on "Calculating fare…"
  // with a permanently disabled CTA.
  const [estimateError, setEstimateError] = useState(false);
  // Bumping this re-runs the estimate effect (retry).
  const [estimateAttempt, setEstimateAttempt] = useState(0);

  const rerunEstimate = useCallback(() => {
    setEstimateAttempt((n) => n + 1);
  }, []);

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
    const estimateInput = {
      errand_type_id: draftBooking.errand_type_id,
      pickup_lat: draftBooking.pickup_lat,
      pickup_lng: draftBooking.pickup_lng,
      dropoff_lat: draftBooking.dropoff_lat,
      dropoff_lng: draftBooking.dropoff_lng,
      // Multi-stop legs change the fare, so they're part of the quote input.
      stops: draftBooking.stops?.map((s) => ({ lat: s.lat, lng: s.lng })),
    };
    // P1: if the estimate was warmed at the details phase-flip and is still
    // fresh, hydrate synchronously so the fare paints and Confirm is tappable on
    // Review's very first frame — no POST round-trip. A manual retry
    // (estimateAttempt > 0) bypasses the cache to force a fresh fetch.
    const cached =
      estimateAttempt === 0 ? bookingService.getCachedEstimate(estimateInput) : null;
    if (cached) {
      setEstimate(cached);
      // Preserve the offer seed: only when the user hasn't set one.
      if (cached.min_negotiate_fee && draftBooking.customer_offer == null) {
        setOfferPrice(cached.min_negotiate_fee);
      }
      setEstimateError(false);
      setIsEstimateLoading(false);
      return;
    }
    let cancelled = false;
    setIsEstimateLoading(true);
    setEstimateError(false);
    bookingService
      // Deduped fetch that also caches — coalesces with any prefetch still in
      // flight; resolves to the unwrapped estimate (not the axios response).
      .fetchEstimate(estimateInput)
      .then((data) => {
        if (cancelled) return;
        setEstimate(data ?? null);
        // Only seed offer if the user hasn't already set one — never
        // overwrite their explicit choice with a server suggestion.
        if (data?.min_negotiate_fee && draftBooking.customer_offer == null) {
          setOfferPrice(data.min_negotiate_fee);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Surface the failure inline (ErrorState below) instead of
        // stranding the user on an eternal "Calculating fare…".
        setEstimateError(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => {},
        );
      })
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
    estimateAttempt,
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
      perKm: 0,
      estimatedTotal: estimate?.walk?.total_amount ?? 0,
      eta: etaFor('walk'),
    },
    {
      key: 'bicycle',
      label: 'Bicycle',
      perKm: 0,
      estimatedTotal: estimate?.bicycle?.total_amount ?? 0,
      eta: etaFor('bicycle'),
    },
    {
      key: 'motorcycle',
      label: 'Motorcycle',
      perKm: 0,
      estimatedTotal: estimate?.motorcycle?.total_amount ?? 0,
      eta: etaFor('motorcycle'),
    },
    {
      key: 'car',
      label: 'Car',
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

  // Clamped at zero — a fixed-amount promo larger than the fare must never
  // render "Confirm ₱-20.00".
  const totalAmount = currentVehicleEstimate
    ? Math.max(0, (currentVehicleEstimate.total_amount ?? 0) - promoDiscount)
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

  // Readbacks for the confirmation summary — a "Review & confirm" screen
  // has to show what is being confirmed (type, timing, list size), not
  // just where and for how much.
  const errandTypeLabel = useMemo(() => {
    const slug = draftBooking.errand_type_slug;
    if (!slug) return 'Errand';
    const words = slug.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }, [draftBooking.errand_type_slug]);

  const scheduleLabel =
    draftBooking.schedule_type === 'scheduled' && draftBooking.scheduled_at
      ? `Scheduled · ${dayjs(draftBooking.scheduled_at).format('ddd, MMM D · h:mm A')}`
      : 'Now';

  const shoppingItemCount = rule.requiresShoppingBudget
    ? (draftBooking.shoppingItems ?? []).filter((it) => it.name.trim()).length
    : 0;

  // navigate() returns to the step already on the stack instead of pushing
  // a duplicate; the persisted draft makes the round-trip lossless.
  const editStep = useCallback(
    (path: '/(customer)/book/details' | '/(customer)/book/schedule') => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.navigate(path);
    },
    [router],
  );

  const handleSubmit = useCallback(async () => {
    if (!draftBooking.errand_type_id || !draftBooking.pickup_address) {
      toast.warning('Please go back and complete all booking steps.');
      return;
    }
    // Per-errand-type validation. Without these the server would 422 the
    // request after the user already tapped Confirm — slow + ugly.
    // Shopping types validate their checklist; all others validate the
    // free-text description.
    const shoppingItems = rule.requiresShoppingBudget
      ? (draftBooking.shoppingItems ?? []).filter((it) => it.name.trim())
      : [];
    if (rule.requiresShoppingBudget) {
      if (shoppingItems.length === 0) {
        toast.warning('Please add at least one item to your shopping list.');
        return;
      }
    } else if (
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
    // Don't start a new payment while a previous one is still being verified.
    if (isAttemptActive(usePaymentStore.getState().attempt)) {
      toast.info("We're still confirming your last payment — hang tight.");
      return;
    }
    // Synchronous latch closes the double-tap window before Button `loading`.
    if (submitLatch.current) return;
    submitLatch.current = true;
    const paymentAmount = pricingMode === 'negotiate' ? offerPrice ?? 0 : totalAmount;
    // One attempt = one idempotency key, reused on retry so the backend can
    // never create two bookings / two charges from a double-tap or retry.
    const payAttempt = beginAttempt({
      kind: 'booking',
      amount: paymentAmount,
      method: paymentMethodType ?? 'cash',
    });
    setIsSubmitting(true);
    // Surface the full-screen staged overlay immediately on tap — "Checking
    // your details ✓ / Creating your errand ⟳" — instead of a lone button
    // spinner during the multi-second create round-trip.
    setBookingStage('creating');
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
        // Shopping checklists have no structured column on the API, so the
        // list is serialized into the free-text `description` — the
        // canonical, human-readable form the runner & admin see. The
        // shopping builder has NO free-text note field, so we do NOT fold
        // `draftBooking.description` in as a note: on a shopping errand any
        // value there is only stale text left over from a previously-chosen
        // non-shopping type, which the customer can neither see nor edit.
        description:
          shoppingItems.length > 0
            ? serializeChecklist(shoppingItems)
            : draftBooking.description,
        // Structured checklist alongside the human-readable `description`
        // serialization above. The server stores this as the canonical
        // shopping_items column, which the runner's synced checklist reads
        // from — making the ticked-off list authoritative rather than
        // re-parsed from free text.
        shopping_items:
          shoppingItems.length > 0
            ? shoppingItems.map((i) => ({ name: i.name.trim(), qty: i.qty }))
            : undefined,
        special_instructions: draftBooking.special_instructions,
        // Multi-stop extra destinations (server prices + persists them).
        stops:
          draftBooking.stops && draftBooking.stops.length > 0
            ? draftBooking.stops
            : undefined,
        estimated_item_value: draftBooking.estimated_item_value,
        shopping_budget: draftBooking.shopping_budget,
        pricing_mode: pricingMode,
        vehicle_type_rate: pricingMode === 'fixed' ? vehicleType : undefined,
        customer_offer: pricingMode === 'negotiate' ? offerPrice : undefined,
        schedule_type: draftBooking.schedule_type ?? ('now' as const),
        scheduled_at: draftBooking.scheduled_at,
        payment_method: paymentMethodType ?? 'cash',
        // Sentinel ids (prefixed "__") are the universal choices
        // (wallet/gcash/maya/card/cash) that have no saved PaymentMethod
        // row — omit payment_method_id for them; online ones settle via a
        // Xendit hosted checkout.
        payment_method_id: draftBooking.payment_method_id?.startsWith('__')
          ? undefined
          : draftBooking.payment_method_id,
        promo_code: draftBooking.promo_code,
      };

      const res = await bookingService.createBooking(payload, {
        idempotencyKey: payAttempt.idempotencyKey,
      });
      const booking = res.data.data;
      const checkoutUrl: string | undefined = res.data?.checkout_url;
      const paymentId: string | undefined = res.data?.payment_id;
      // Outcome haptic — the booking was accepted by the server.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      // Warm the pickup→dropoff route geometry now, fire-and-forget, so the
      // tracking screen's pre-dispatch polyline paints on its first frame —
      // especially on the rebook path, which lands here via review without
      // passing through the details map where this cache otherwise gets filled.
      // Writes the same `route4:driving:{coords}` key getRoute/tracking read, so
      // there are zero net HERE calls in steady state. Read the draft coords
      // BEFORE clearDraft() wipes them. Guard null dropoff (single-location). (P31)
      if (
        draftBooking.pickup_lat != null &&
        draftBooking.pickup_lng != null &&
        draftBooking.dropoff_lat != null &&
        draftBooking.dropoff_lng != null
      ) {
        void routeService.getRoute(
          { lat: draftBooking.pickup_lat, lng: draftBooking.pickup_lng },
          { lat: draftBooking.dropoff_lat, lng: draftBooking.dropoff_lng },
        );
      }
      setActiveBooking(booking);
      clearDraft();
      if (checkoutUrl) {
        // Online / saved-method charge: VERIFY, never assume. Stash the invoice
        // URL so a failed "Try again" re-opens the SAME invoice (no duplicate
        // booking). The inline PaymentProgress overlay drives navigation from
        // here based on the verified outcome.
        if (paymentId) linkPayment(paymentId);
        // Bridge from create to the gateway sheet; PaymentProgress takes over
        // from the verification stage onward (mutually exclusive — see render).
        setBookingStage('checkout');
        setAttemptStatus('awaiting_gateway', {
          bookingId: booking.id,
          checkoutUrl,
          reference: booking.booking_number,
        });
        await openCheckoutUrl(checkoutUrl, PAYMENT_RETURN_URL);
        // Regardless of the sheet's reported outcome we now VERIFY with the
        // backend — 'cancelled' doesn't prove they didn't pay. Drop the create
        // overlay so the verification overlay owns the screen.
        setBookingStage(null);
        setAttemptStatus('verifying');
      } else {
        // Wallet/cash settle server-side already — nothing to verify.
        resolveAttempt();
        // Drop the create overlay before the confirm screen replaces us.
        setBookingStage(null);
        router.replace(`/(customer)/book/confirm?bookingId=${booking.id}`);
      }
    } catch (err: any) {
      // Create failed → no booking/charge exists to verify; clear the attempt.
      // Honest copy per backend code: promo invalid, insufficient balance,
      // gateway ("you weren't charged"), or a booking conflict.
      resolveAttempt();
      setBookingStage(null);
      haptics.error();
      toast.error(errorMessage(err, copy.booking.createFailed));
    } finally {
      setIsSubmitting(false);
      submitLatch.current = false;
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
    totalAmount,
    beginAttempt,
    linkPayment,
    setAttemptStatus,
    resolveAttempt,
  ]);

  // Re-open the SAME checkout URL on a failed-payment retry (never re-create
  // the booking). Only safe for CARD: its hosted Xendit invoice stays payable
  // until it expires, so re-opening re-offers the card form. GCash/Maya now use
  // a ONE-TIME payment_request whose authorization URL is DEAD once the charge
  // fails — re-opening it would land on a Xendit error page — so retry is not
  // offered for e-wallets (see onRetry gate); the customer exits and rebooks.
  const retryBookingPayment = useCallback(async () => {
    const url = usePaymentStore.getState().attempt?.checkoutUrl;
    if (!url) return;
    setAttemptStatus('awaiting_gateway');
    await openCheckoutUrl(url, PAYMENT_RETURN_URL);
    setAttemptStatus('verifying');
  }, [setAttemptStatus]);

  const leaveForBooking = useCallback(
    (opts?: { keepAttempt?: boolean }) => {
      const id = usePaymentStore.getState().attempt?.bookingId;
      if (!opts?.keepAttempt) resolveAttempt();
      if (id) router.replace(`/(customer)/book/confirm?bookingId=${id}`);
    },
    [resolveAttempt, router],
  );

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

      {/* Step indicator — clamped to the same content column as the
          scroll body so tablet edges align (mirrors type.tsx). */}
      <View className="px-5 mt-3 pb-3">
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <BookingStepIndicator currentStep={3} />
        </View>
      </View>

      {/* Keyboard handling mirrors details.tsx — without persistTaps the
          promo Apply tap is swallowed by keyboard dismissal (two taps to
          apply), and bottom-half inputs hide under the iOS keyboard. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
          // Clearance for the sticky BottomActionBar: its real height is
          // 16 top pad + button + max(inset, 12) bottom pad, so a fixed
          // spacer under-clears on home-indicator / 3-button-nav devices.
          paddingBottom: Math.max(insets.bottom, 12) + 96,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Route Summary — typographic, ride-hailing-style two-line
            stack with a connecting hairline. No icon-tile chips. Rows are
            tappable edit affordances back to the details step — fixing a
            wrong address here beats abandoning the funnel. */}
        <View className="mb-5 py-3 border-y border-divider">
          <Pressable
            className="flex-row items-center mb-2.5"
            accessibilityRole="button"
            accessibilityLabel={`Pickup: ${draftBooking.pickup_address ?? 'not set'}. Edit`}
            hitSlop={8}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            onPress={() => editStep('/(customer)/book/details')}
          >
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LightColors.primary }}
            />
            <View className="flex-1 ml-3">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.4 }}
              >
                Pickup
              </Text>
              <Text className="text-[14px] font-montserrat-semi text-textPrimary" numberOfLines={1}>
                {draftBooking.pickup_address ?? 'Pickup location'}
              </Text>
            </View>
            <Text className="text-[13px] font-montserrat-semi text-primary ml-3">
              Edit
            </Text>
          </Pressable>
          <View
            style={{
              marginLeft: 3,
              width: 2,
              height: 12,
              backgroundColor: LightColors.divider,
            }}
          />
          <Pressable
            className="flex-row items-center mt-2.5"
            accessibilityRole="button"
            accessibilityLabel={`Drop-off: ${draftBooking.dropoff_address ?? 'not set'}. Edit`}
            hitSlop={8}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            onPress={() => editStep('/(customer)/book/details')}
          >
            {/* Danger circle — the funnel's learned drop-off cue from the
                details map (pin, marker, route bead all danger red). */}
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LightColors.danger }}
            />
            <View className="flex-1 ml-3">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.4 }}
              >
                Drop-off
              </Text>
              <Text className="text-[14px] font-montserrat-semi text-textPrimary" numberOfLines={1}>
                {draftBooking.dropoff_address ?? 'Drop-off location'}
              </Text>
            </View>
            <Text className="text-[13px] font-montserrat-semi text-primary ml-3">
              Edit
            </Text>
          </Pressable>

          {/* Extra stops (multi-stop) — continue the route after the drop-off,
              same danger bead as the drop-off since they're all destinations. */}
          {(draftBooking.stops ?? []).map((stop, i) => (
            <View key={`${stop.lat},${stop.lng},${i}`}>
              <View
                style={{ marginLeft: 3, width: 2, height: 12, backgroundColor: LightColors.divider }}
              />
              <Pressable
                className="flex-row items-center mt-2.5"
                accessibilityRole="button"
                accessibilityLabel={`Stop ${i + 1}: ${stop.address}. Edit`}
                hitSlop={8}
                style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
                onPress={() => editStep('/(customer)/book/details')}
              >
                <View
                  style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LightColors.danger }}
                />
                <View className="flex-1 ml-3">
                  <Text
                    className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                    style={{ letterSpacing: 1.4 }}
                  >
                    Stop {i + 1}
                  </Text>
                  <Text className="text-[14px] font-montserrat-semi text-textPrimary" numberOfLines={1}>
                    {stop.address}
                  </Text>
                </View>
                <Text className="text-[13px] font-montserrat-semi text-primary ml-3">
                  Edit
                </Text>
              </Pressable>
            </View>
          ))}
        </View>

        {/* What's being booked — type, timing, list size. */}
        <View className="mb-5 rounded-2xl border border-divider bg-surface px-4">
          <View className="flex-row items-center justify-between py-3">
            <Text className="text-[12px] font-montserrat text-textSecondary">
              Errand
            </Text>
            <Text className="text-[13px] font-montserrat-semi text-textPrimary ml-3 flex-shrink" numberOfLines={1}>
              {errandTypeLabel}
            </Text>
          </View>
          <Pressable
            className="flex-row items-center justify-between py-3 border-t border-divider"
            accessibilityRole="button"
            accessibilityLabel={`Schedule: ${scheduleLabel}. Edit`}
            hitSlop={8}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            onPress={() => editStep('/(customer)/book/schedule')}
          >
            <Text className="text-[12px] font-montserrat text-textSecondary">
              Schedule
            </Text>
            <View className="flex-row items-center ml-3 flex-shrink">
              <Text className="text-[13px] font-montserrat-semi text-textPrimary flex-shrink" numberOfLines={1}>
                {scheduleLabel}
              </Text>
              <Text className="text-[13px] font-montserrat-semi text-primary ml-3">
                Edit
              </Text>
            </View>
          </Pressable>
          {rule.requiresShoppingBudget && (
            <View className="flex-row items-center justify-between py-3 border-t border-divider">
              <Text className="text-[12px] font-montserrat text-textSecondary">
                Shopping list
              </Text>
              <Text className="text-[13px] font-montserrat-semi text-textPrimary ml-3">
                {shoppingItemCount} {shoppingItemCount === 1 ? 'item' : 'items'}
              </Text>
            </View>
          )}
        </View>

        {/* Distance & Time — inline typographic stat row, no chips. */}
        {estimate?.distance_km != null && (
          <View className="flex-row items-center mb-5" style={{ gap: 16 }}>
            <View className="flex-row items-center">
              <Route size={13} color={LightColors.textTertiary} strokeWidth={2} />
              <Text className="text-[12px] font-inter tabular-nums text-textSecondary ml-1.5">
                {estimate.distance_km.toFixed(1)} km
              </Text>
            </View>
            {getEstimatedTime() && (
              <View className="flex-row items-center">
                <Clock size={13} color={LightColors.textTertiary} strokeWidth={2} />
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
                style={({ pressed }) => [
                  active
                    ? { borderBottomWidth: 2, borderBottomColor: LightColors.primary }
                    : null,
                  pressed ? { opacity: 0.7 } : null,
                ]}
                // The tab itself is only ~28pt tall (13px label + 10px
                // underline gap) — the vertical slop lifts it past 44pt.
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
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
            ) : estimateError ? (
              /* Estimate failed — inline recovery in place of the
                 skeleton so the user is never stuck on a dead
                 "Calculating fare…" with no way forward. */
              <View className="mb-4">
                <ErrorState
                  compact
                  title="Couldn't calculate your fare"
                  description="Check your connection and try again."
                  onRetry={rerunEstimate}
                />
              </View>
            ) : (
              /* Estimate skeleton — mirrors the real PriceBreakdown's
                 metrics (4 fee rows @ ~33pt, total row @ ~40pt) so the
                 sections below don't reflow when the data arrives. */
              <View className="mb-4" accessibilityLabel="Calculating fare">
                {Array.from({ length: 4 }).map((_, i) => (
                  <View
                    key={`pb-skel-${i}`}
                    className="flex-row items-center justify-between"
                    style={{ height: 33 }}
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
                <View
                  className="border-t border-divider mt-1 pt-3 flex-row items-center justify-between"
                  style={{ height: 40 }}
                >
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

        {/* Shopping budget — a real pre-authorized outlay on top of the
            service fee, kept out of the fee Total (it's reconciled with a
            receipt) but explicit at the moment of commitment. Typographic
            row (not a card) so its amount sits in the same money column
            as the PriceBreakdown lines above it. */}
        {rule.requiresShoppingBudget && (draftBooking.shopping_budget ?? 0) > 0 && (
          <View className="mb-4 flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-montserrat text-textSecondary">
                Shopping budget
              </Text>
              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                Advanced for items, on top of the fee — reconciled with the receipt
              </Text>
            </View>
            <Text
              className="text-sm font-inter text-textPrimary"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatCurrency(draftBooking.shopping_budget!)}
            </Text>
          </View>
        )}

        {/* Promo Code */}
        <PromoCodeInput
          appliedCode={draftBooking.promo_code}
          appliedDiscount={promoDiscount}
          onApply={(code, discount) => {
            updateDraft({ promo_code: code, promo_discount: discount });
          }}
          onRemove={() => {
            updateDraft({ promo_code: undefined, promo_discount: undefined });
          }}
        />

        {/* Payment Method */}
        <PaymentMethodSelector
          selectedId={draftBooking.payment_method_id}
          // Fixed-price bookings charge `totalAmount` up front, so the wallet
          // must cover it; negotiate bookings settle later at the agreed
          // offer, so gate on that instead. This lets the selector grey out
          // the wallet when the balance is short.
          amount={pricingMode === 'fixed' ? totalAmount : offerPrice}
          onSelect={(id, type) => {
            updateDraft({ payment_method_id: id });
            setSavedMethodType(type);
          }}
        />

      </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom CTA — clamped to the content column on tablets. */}
      <BottomActionBar>
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <Button
            title={
              pricingMode === 'fixed'
                ? currentVehicleEstimate && !isEstimateLoading
                  ? `Confirm ${formatCurrency(totalAmount)}`
                  : estimateError
                    ? 'Fare unavailable'
                    : 'Calculating fare…'
                : `Send Offer ${formatCurrency(offerPrice)}`
            }
            onPress={handleSubmit}
            loading={isSubmitting}
            loadingTitle={pricingMode === 'fixed' ? 'Creating booking…' : 'Sending offer…'}
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
        </View>
      </BottomActionBar>

      {/* Full-screen create overlay — fills the multi-second create round-trip
          that previously showed only a button spinner (staged: Checking →
          Creating → Opening checkout). Mutually exclusive with PaymentProgress
          below: once the gateway verification is live, that overlay wins so the
          two Modals never stack. */}
      <BookingProgress
        stage={
          attempt?.kind === 'booking' && verifyStage && verifyStage !== 'preparing'
            ? null
            : bookingStage
        }
      />

      {/* Honest payment verification for online / saved-method charges. Hidden
          during 'preparing' (BookingProgress covers the create call above); it
          takes over from the gateway hand-off onward. Wallet/cash resolve
          before this ever shows. */}
      <PaymentProgress
        stage={
          attempt?.kind === 'booking' && verifyStage && verifyStage !== 'preparing'
            ? verifyStage
            : null
        }
        offline={isOffline}
        successTitle="Payment confirmed"
        successCta="Continue"
        receipt={
          attempt
            ? {
                amount: attempt.amount,
                method: attempt.method,
                reference: attempt.reference,
                paidAt: attempt.paidAt,
              }
            : undefined
        }
        onSuccessDone={() => leaveForBooking()}
        failureMessage={
          attempt?.failureReason ? mapFailureReason(attempt.failureReason).message : undefined
        }
        onRetry={attempt?.checkoutUrl && attempt?.method === 'card' ? retryBookingPayment : undefined}
        onClose={() => leaveForBooking()}
        onSafeExit={() => leaveForBooking()}
      />
    </View>
  );
}
