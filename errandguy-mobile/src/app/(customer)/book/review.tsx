import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  AccessibilityInfo,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Clock, Route, WifiOff } from 'lucide-react-native';
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
import { PaymentMethodSelector } from '../../../components/customer/PaymentMethodSelector';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';
import { formatCurrency } from '../../../utils/formatCurrency';
import { serializeChecklist } from '../../../utils/shoppingChecklist';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../../../utils/browser';
import { PaymentProgress } from '../../../components/ui/PaymentProgress';
import {
  BookingProgress,
  type BookingStage,
} from '../../../components/customer/BookingProgress';
import {
  usePaymentStore,
  isAttemptActive,
  shouldRetainIdempotencyKey,
} from '../../../stores/paymentStore';
import { newIdempotencyKey } from '../../../utils/idempotency';
import { fareLines } from '../../../utils/fareLines';
import { usePaymentVerification } from '../../../hooks/usePaymentVerification';
import {
  bookingPaymentFailure,
  settleClosedCheckout,
} from '../../../hooks/useCompleteBookingPayment';
import { rebookDraft } from '../../../utils/rebookDraft';
import { invalidateQuery, useQuery } from '../../../hooks/useQuery';
import { configService } from '../../../services/config.service';
import { CacheTTL } from '../../../services/cache.service';
import { useRetiredErrandTypeGuard } from '../../../hooks/useRetiredErrandTypeGuard';
import { useAuthStore } from '../../../stores/authStore';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { shoppingBudgetError, shoppingBudgetMax } from '../../../utils/shoppingMoney';
import {
  bookingVehicle,
  getErrandTypeRule,
  type VehicleKey,
} from '../../../constants/errandTypeRules';
import { useResponsive } from '../../../constants/responsive';
import { LightColors } from '../../../constants/colors';
import type { ErrandType } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { haptics } from '../../../utils/haptics';


/** Back-off between item-photo upload attempts. Two extra tries ≈ 8.5s — short
 *  enough that the staged local camera URIs are still readable (they live in
 *  the app's own cache dir and are only reclaimed much later), so there is no
 *  expiry window to guard against the way a persisted retry queue would have. */
const PHOTO_RETRY_DELAYS_MS = [2500, 6000];

/**
 * Attach the customer's staged item photos to a just-created booking.
 *
 * Best-effort by design (the booking already exists), but a single transport
 * blip used to end in "reopen the errand chat to resend them" — asking the
 * customer to redo work the app can simply repeat. Retries the transport-class
 * failures only, then falls back to the same honest message.
 *
 * Deliberately module-level and un-awaited: it must outlive this screen, which
 * navigates away to the confirm screen the moment create succeeds.
 */
async function attachItemPhotos(bookingId: string, uris: string[]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await bookingService.uploadItemPhotos(bookingId, uris);
      return;
    } catch (err: any) {
      // Only repeat failures that a repeat can actually fix. A 422 (unsupported
      // file, too large, runner already picked up) fails identically forever,
      // and a 'timeout' may well have landed server-side — re-sending that one
      // would duplicate the photos rather than rescue them.
      const transient = err?.kind === 'offline' || err?.kind === 'server';
      const delay = PHOTO_RETRY_DELAYS_MS[attempt];
      if (!transient || delay === undefined) {
        // Be precise about the recovery. The old copy said to "resend them" in
        // chat, but chat images post to a different endpoint and can never
        // re-attach as item photos — so it pointed at something that cannot
        // work. Sending them to the runner in chat DOES work, and that is what
        // this now promises.
        toast.warning(
          "Some item photos couldn't upload — you can send them to your runner in the errand chat.",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

interface EstimateResult {
  walk?: { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  bicycle?: { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  motorcycle?: { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  car?: { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number };
  distance_km?: number;
}

// Screen-reader copy for the full-screen create overlay (BookingProgress).
// The overlay covers the screen for the multi-second create round-trip and
// renders its stage label visually only, so without this a blind customer taps
// "Confirm & pay" and hears nothing until navigation lands. Mirrors the
// STATE_ANNOUNCEMENTS pattern in book/confirm.tsx.
const BOOKING_STAGE_ANNOUNCEMENTS: Record<BookingStage, string> = {
  checking: 'Confirming your details.',
  creating: 'Booking your errand. This can take a few seconds.',
  checkout: 'Opening secure checkout.',
};

export default function ReviewScreen() {
  const router = useRouter();
  const { contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.user?.id);
  const setLastPaymentMethod = usePreferencesStore((s) => s.setLastPaymentMethod);
  // Per-field selectors avoid re-rendering on unrelated bookingStore writes.
  const draftBooking = useBookingStore((s) => s.draftBooking);
  const updateDraft = useBookingStore((s) => s.updateDraft);
  const setStep = useBookingStore((s) => s.setStep);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const setCreateKey = useBookingStore((s) => s.setCreateKey);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
  // A draft naming a retired errand type (a rebook of an older booking, or a
  // draft an older build saved) goes back to the type picker.
  useRetiredErrandTypeGuard();

  const [estimate, setEstimate] = useState<EstimateResult | null>(null);

  // Per-errand-type rule (allowed vehicles, default vehicle, etc.)
  const rule = useMemo(
    () => getErrandTypeRule(draftBooking.errand_type_slug),
    [draftBooking.errand_type_slug],
  );

  const initialVehicle = useMemo<VehicleKey>(
    () => bookingVehicle(rule, draftBooking.vehicle_type_rate),
    [draftBooking.vehicle_type_rate, rule],
  );

  const [vehicleType, setVehicleType] = useState<string>(initialVehicle);

  // If the rule changes (e.g. user changed errand type) and the current
  // vehicle is no longer allowed, snap back to the rule's default. The draft
  // follows too, so a restored draft holding an older pick (a queue errand
  // saved on a motorcycle) can't keep it.
  useEffect(() => {
    const vehicle = bookingVehicle(rule, vehicleType);
    if (vehicle !== vehicleType) setVehicleType(vehicle);
    if (draftBooking.vehicle_type_rate && draftBooking.vehicle_type_rate !== vehicle) {
      updateDraft({ vehicle_type_rate: vehicle });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule]);
  // Read straight from the draft, so the submitted `payment_method` always
  // matches the visible selection — including a restored draft.
  const paymentMethodType = draftBooking.payment_method;
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
  // The create's Idempotency-Key, held in a screen-local ref (the pattern
  // (runner)/payout/index.tsx already uses) so it OUTLIVES the attempt the
  // catch block resolves. A mutation gets a flat 30s timeout and no retry
  // layer, so a slow create can time out client-side while the server
  // completes it; re-sending the SAME key makes EnsureIdempotency replay the
  // original 201 instead of minting a second booking and a second charge.
  // Keeping it OUT of the persisted attempt means retaining the key never also
  // retains the one-payment-at-a-time lock the retry would trip over.
  // The payload the retained key was first used with. A key re-sent with a
  // materially different body is rejected 422 ("already used with a different
  // request"), so any edit to the draft/fare/method rotates it.
  // The attempt THIS screen started. The verification overlay is gated on it so
  // a previous booking's rehydrated attempt can never flip terminal over a new
  // draft and teleport the customer to the old booking (its outcome belongs to
  // /payment-complete, which the blocked-submit toast below links to).
  const ownedAttemptRef = useRef<string | null>(null);
  // Which of the two mutually exclusive overlays is up. Hoisted out of the
  // JSX so the screen-reader announcement below and the render agree on one
  // source of truth (they were duplicated expressions).
  const paymentOverlayStage =
    attempt?.kind === 'booking' &&
    attempt.attemptId === ownedAttemptRef.current &&
    verifyStage &&
    verifyStage !== 'preparing'
      ? verifyStage
      : null;
  const createOverlayStage = paymentOverlayStage ? null : bookingStage;
  // What the failure card says and offers — one mapping shared with the
  // waiting screen and tracking (useCompleteBookingPayment).
  const paymentFailure =
    paymentOverlayStage === 'failed' ? bookingPaymentFailure(attempt?.failureReason) : null;

  // Announce the create overlay's stage changes. BookingProgress is a
  // full-screen Modal whose stage label is visual only, so submitting was
  // silent from tap to navigation. Same treatment as book/confirm.tsx's
  // STATE_ANNOUNCEMENTS. PaymentProgress announces its own stages, so the
  // hand-off between the two overlays never double-speaks.
  const spokenStageRef = useRef<BookingStage | null>(null);
  useEffect(() => {
    if (!createOverlayStage) {
      spokenStageRef.current = null;
      return;
    }
    if (spokenStageRef.current === createOverlayStage) return;
    spokenStageRef.current = createOverlayStage;
    AccessibilityInfo.announceForAccessibility(
      BOOKING_STAGE_ANNOUNCEMENTS[createOverlayStage],
    );
  }, [createOverlayStage]);

  // Pre-empt the create ceremony while the app knows it has no connection.
  // Never while a submit is already in flight: the POST that dropped the
  // connection is what SET this flag, and swapping the button out from under
  // an in-flight attempt would hide the honest loading state.
  const showOfflineGate = isOffline && !isSubmitting;
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

  // Hide vehicles this errand type doesn't support (every current type allows
  // all four; the rule keeps the per-type hook).
  const vehicleOptions = allVehicleOptions.filter((opt) =>
    rule.allowedVehicles.includes(opt.key as VehicleKey),
  );

  const currentVehicleEstimate = estimate?.[vehicleType as keyof EstimateResult] as
    | { total_amount: number; distance_fee: number; base_fee: number; service_fee: number; surcharge: number }
    | undefined;

  const priceItems = fareLines(currentVehicleEstimate);

  const totalAmount = currentVehicleEstimate?.total_amount ?? 0;

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
  //
  // The type reads back by its server name ("Buy for me", not "Purchase"),
  // from the same ['errand-types'] entry Home and the picker keep warm; the
  // slug only stands in while that cache is cold.
  const errandTypesQ = useQuery<ErrandType[]>(
    ['errand-types'],
    async () => {
      const res = await configService.getErrandTypes();
      return (res.data?.data ?? []) as ErrandType[];
    },
    { staleTime: 60 * 60 * 1000, ttl: CacheTTL.STATIC },
  );
  const errandTypeLabel = useMemo(() => {
    const named = errandTypesQ.data?.find((t) => t.id === draftBooking.errand_type_id)?.name;
    if (named) return named;
    const slug = draftBooking.errand_type_slug;
    if (!slug) return 'Errand';
    const words = slug.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }, [errandTypesQ.data, draftBooking.errand_type_id, draftBooking.errand_type_slug]);

  // The runner fronts the item money in cash, so the catalog caps the budget.
  // Re-checked here because a rebook lands on Review without passing Details.
  const budgetMax = shoppingBudgetMax(
    errandTypesQ.data?.find((t) => t.id === draftBooking.errand_type_id),
  );

  const isScheduled = draftBooking.schedule_type === 'scheduled' && !!draftBooking.scheduled_at;
  // Chose "Later" but no time yet (e.g. the app was closed on the picker after
  // Home's Schedule shortcut). Never shown as "Now": it isn't booked as now.
  const needsScheduleTime = draftBooking.schedule_type === 'scheduled' && !draftBooking.scheduled_at;
  const scheduleLabel = isScheduled
    ? `Scheduled · ${dayjs(draftBooking.scheduled_at).format('ddd, MMM D · h:mm A')}`
    : needsScheduleTime
      ? 'Later · no time picked'
      : 'Now';
  // Booking goes straight from details to here on "Now", so this row is the
  // one way to book for later — say so instead of a bare "Edit".
  const scheduleAction = isScheduled ? 'Edit' : needsScheduleTime ? 'Pick a time' : 'Schedule for later';

  const shoppingItemCount = rule.requiresShoppingBudget
    ? (draftBooking.shoppingItems ?? []).filter((it) => it.name.trim()).length
    : 0;

  // navigate() returns to the step already on the stack instead of pushing
  // a duplicate; the persisted draft makes the round-trip lossless.
  const editStep = useCallback(
    (
      path:
        | '/(customer)/book/details'
        | '/(customer)/book/schedule'
        | '/(customer)/book/schedule?later=1',
    ) => {
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
    if (rule.requiresShoppingBudget) {
      const budgetProblem = shoppingBudgetError(draftBooking.shopping_budget, budgetMax);
      if (budgetProblem) {
        toast.warning(budgetProblem, {
          actionLabel: 'Edit',
          onAction: () => editStep('/(customer)/book/details'),
        });
        return;
      }
    }
    // A scheduled time can drift out of the server's [now+30min, now+30d] window
    // between the schedule step and Confirm — the earliest slot is only ~30 min
    // out, and a day-30 slot can exceed +30d by its time-of-day. Re-validate here,
    // BEFORE the latch / idempotency key / payment attempt, and send the user back
    // to the picker to choose a fresh time instead of burning an attempt on a
    // guaranteed 422.
    if (draftBooking.schedule_type === 'scheduled') {
      const when = draftBooking.scheduled_at ? dayjs(draftBooking.scheduled_at) : null;
      if (
        !when ||
        when.isBefore(dayjs().add(30, 'minute')) ||
        when.isAfter(dayjs().add(30, 'day'))
      ) {
        updateDraft({ scheduled_at: undefined });
        toast.error(
          when
            ? 'Your scheduled time is no longer valid — please pick a new one.'
            : 'Pick a time for your errand first.',
        );
        router.push('/(customer)/book/schedule');
        return;
      }
    }
    // Don't start a new payment while a previous one is still being verified.
    // The blocking attempt can be a TIP (or a booking from a previous launch),
    // which this screen's overlay deliberately doesn't render — so the toast
    // has to hand over an escape instead of being a dead end.
    // /payment-complete mounts the verifier, renders any attempt kind, and its
    // "Got it" resolves the attempt, which releases this lock.
    if (isAttemptActive(usePaymentStore.getState().attempt)) {
      toast.info("We're still confirming your last payment — hang tight.", {
        actionLabel: 'Check status',
        onAction: () => router.push('/payment-complete'),
      });
      return;
    }
    // Synchronous latch closes the double-tap window before Button `loading`.
    if (submitLatch.current) return;
    submitLatch.current = true;
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
        vehicle_type_rate: vehicleType,
        schedule_type: draftBooking.schedule_type ?? ('now' as const),
        // A time picked and then switched back to "Now" stays in the draft
        // (see schedule.tsx); it must not ride along on a "Now" booking.
        scheduled_at:
          draftBooking.schedule_type === 'scheduled' ? draftBooking.scheduled_at : undefined,
        // GCash/Maya return a checkout_url (a one-time charge approved in
        // their app); wallet is debited now; cash is collected by the runner.
        payment_method: paymentMethodType ?? 'cash',
      };

      // Reuse the retained key when the body is byte-for-byte what it was last
      // time (the server hashes the whole request, so an edited draft MUST get
      // a fresh key); mint one otherwise. This is what turns a timed-out create
      // into a replay of the original booking rather than a second one.
      // Read from the STORE, not a component ref. The ref died with the
      // process while the draft survived it, so a customer who force-quit
      // during the create came back to a resume card that minted a fresh key —
      // and the server, seeing a new key, created a SECOND errand with a
      // SECOND charge. Two runners to one pickup, two amounts to pay.
      const payloadSignature = JSON.stringify(payload);
      const persisted = useBookingStore.getState();
      let createKey = persisted.createKey;
      if (!createKey || persisted.createKeySig !== payloadSignature) {
        createKey = newIdempotencyKey();
        setCreateKey(createKey, payloadSignature);
      }
      // One attempt = one idempotency key, reused on retry so the backend can
      // never create two bookings / two charges from a double-tap or retry.
      const payAttempt = beginAttempt({
        kind: 'booking',
        amount: totalAmount,
        method: paymentMethodType ?? 'cash',
        idempotencyKey: createKey,
      });
      ownedAttemptRef.current = payAttempt.attemptId;

      const res = await bookingService.createBooking(payload, {
        idempotencyKey: payAttempt.idempotencyKey,
      });
      // The server has spoken: this key is spent. A follow-up booking (even an
      // identical rebook) must charge on its own key.
      setCreateKey(null, null);
      const booking = res.data.data;
      // The create body is JSON (no file parts), so the customer's staged item
      // photos are uploaded here right after — best-effort, since the booking
      // already exists. Without this the attached photos were silently dropped.
      if (draftBooking.item_photos?.length && booking?.id) {
        // Retries the transport-class failures before asking the customer to
        // resend anything by hand (see attachItemPhotos). Un-awaited: this
        // screen is about to be replaced by the confirm screen.
        void attachItemPhotos(booking.id, draftBooking.item_photos);
      }
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
      // Remember HOW they paid so the next booking pre-selects it instead of
      // resetting to Cash (a GCash regular re-picked GCash on every single
      // errand). Pre-selection only: the selector still shows it on Review and
      // the Confirm button still carries the amount, and nothing here touches
      // what the server charges. Recorded on create success, which is the point
      // the customer's choice actually produced a booking.
      if (userId && paymentMethodType) {
        setLastPaymentMethod(userId, paymentMethodType);
      }
      setActiveBooking(booking);
      clearDraft();
      if (checkoutUrl) {
        // GCash/Maya charge: VERIFY, never assume. Stash the checkout URL so
        // "Resume payment" re-opens the SAME charge (no duplicate booking). The
        // inline PaymentProgress overlay drives navigation from here based on
        // the verified outcome.
        if (paymentId) linkPayment(paymentId);
        // Bridge from create to the gateway sheet; PaymentProgress takes over
        // from the verification stage onward (mutually exclusive — see render).
        setBookingStage('checkout');
        setAttemptStatus('awaiting_gateway', {
          bookingId: booking.id,
          checkoutUrl,
          reference: booking.booking_number,
        });
        const outcome = await openCheckoutUrl(checkoutUrl, PAYMENT_RETURN_URL);
        setBookingStage(null);

        if (outcome === 'failed') {
          // The sheet never OPENED, so no payment can have started — verifying
          // would just spin an overlay against an untouched charge. Distinct
          // from 'cancelled' below. The booking exists and is unpaid; the
          // stashed checkout URL means "Try again" reopens the SAME charge
          // rather than creating a second booking.
          setAttemptStatus('failed', {
            bookingId: booking.id,
            checkoutUrl,
            reference: booking.booking_number,
          });
          toast.error("Couldn't open checkout — you weren't charged. Tap Try again to pay.");
          return;
        }

        if (outcome === 'cancelled') {
          // The customer DISMISSED the sheet. Flipping to 'verifying' here used
          // to trap them behind a button-less spinner for the full 35s pending
          // timeout, then claim their payment "is being processed" — for a
          // payment they deliberately never made. And landing straight on the
          // failure card claimed nothing was charged without asking: iOS can
          // report a cancel when the sheet is dismissed AFTER paying but before
          // the redirect. So check ONCE, briefly: paid → the success path; no
          // payment yet → the actionable card, whose "Resume payment" re-opens
          // the SAME charge — no duplicate booking — and whose Close drops them
          // on the waiting screen, where "Complete payment" reopens that charge
          // until the server cancels the unpaid errand.
          await settleClosedCheckout();
          return;
        }

        // Otherwise VERIFY, never assume: 'opened' means the outcome is
        // unknowable (system-browser fallback), and 'success' is only the
        // bridge redirect firing. The verification overlay now owns the screen.
        setAttemptStatus('verifying');
      } else {
        // Wallet/cash settle server-side already — nothing to verify.
        resolveAttempt();
        // A wallet-funded booking is debited server-side at create time, so
        // refresh the wallet cache — otherwise the balance hero and the
        // PaymentMethodSelector keep a stale (too-high) balance for the
        // staleTime window and offer Wallet for a follow-up booking it can no
        // longer cover (server then rejects with INSUFFICIENT_WALLET_BALANCE).
        // Harmless for cash.
        invalidateQuery(['wallet']);
        // Drop the create overlay before the confirm screen replaces us.
        setBookingStage(null);
        router.replace(`/(customer)/book/confirm?bookingId=${booking.id}`);
      }
    } catch (err: any) {
      // Clear the ATTEMPT (it is the one-payment-at-a-time lock, and holding it
      // would block the very retry we want) but decide the KEY on the failure
      // class: a timeout / offline / 5xx / 409 leaves the outcome unknown, so
      // the next Confirm must re-send the SAME key and let the backend replay
      // the original booking instead of creating a second one. Only a definitive
      // 4xx — the server rejecting on its own terms — makes the next tap a
      // genuinely new attempt.
      resolveAttempt();
      if (!shouldRetainIdempotencyKey(err)) {
        setCreateKey(null, null);
      }
      setBookingStage(null);
      haptics.error();
      toast.error(errorMessage(err, copy.booking.createFailed));
    } finally {
      setIsSubmitting(false);
      submitLatch.current = false;
    }
  }, [
    draftBooking,
    vehicleType,
    paymentMethodType,
    rule,
    budgetMax,
    editStep,
    setActiveBooking,
    clearDraft,
    router,
    totalAmount,
    updateDraft,
    userId,
    setLastPaymentMethod,
    beginAttempt,
    linkPayment,
    setAttemptStatus,
    resolveAttempt,
  ]);

  // Re-open the SAME checkout URL on a retry (never re-create the booking). A
  // GCash/Maya charge is a ONE-TIME payment_request, so this is a resume of
  // that same charge: it works while it is still awaiting approval (a sheet
  // that never opened, or one the customer backed out of), and can never
  // charge twice. Once the charge itself has failed its URL is dead and the
  // server cancels the unpaid errand; the waiting screen then offers Book again.
  const retryBookingPayment = useCallback(async () => {
    const url = usePaymentStore.getState().attempt?.checkoutUrl;
    if (!url) return;
    setAttemptStatus('awaiting_gateway');
    const outcome = await openCheckoutUrl(url, PAYMENT_RETURN_URL);
    // Same honest branches as the first attempt: a sheet that never opened, or
    // one the customer dismissed, must NOT spin the verification overlay for
    // 35s. A dismissed one gets the same single quick check, then the
    // actionable failure card so Resume/Close remain there.
    if (outcome === 'failed') {
      setAttemptStatus('failed', { failureReason: undefined });
      toast.error("Couldn't open checkout — you weren't charged. Tap Resume payment to pay.");
      return;
    }
    if (outcome === 'cancelled') {
      await settleClosedCheckout();
      return;
    }
    setAttemptStatus('verifying');
  }, [setAttemptStatus]);

  // The charge is over — declined, expired, or paid too late and refunded — and
  // the server has cancelled the errand, so its checkout can never succeed.
  // Re-seed the draft from that errand right here on Review (the create
  // cleared it), keeping the payment pick visible so the customer can change
  // it: the selector only auto-picks once per mount, and without this the
  // retry would go out with no method shown.
  const rebookAfterFailedPayment = useCallback(() => {
    const id = usePaymentStore.getState().attempt?.bookingId;
    const stored = useBookingStore.getState().activeBooking;
    resolveAttempt();
    ownedAttemptRef.current = null;
    if (stored && stored.id === id) {
      const method = stored.payment_method;
      clearDraft();
      updateDraft({
        ...rebookDraft(stored),
        ...(method === 'gcash' || method === 'maya' || method === 'wallet' || method === 'cash'
          ? { payment_method: method }
          : null),
      });
      setStep(3);
      setActiveBooking(null);
      return;
    }
    // Nothing to re-seed from (the store moved on) — start the errand over
    // rather than leave an empty Review behind.
    setActiveBooking(null);
    router.replace('/(customer)/book/type');
  }, [resolveAttempt, clearDraft, updateDraft, setStep, setActiveBooking, router]);

  const leaveForBooking = useCallback(
    (opts?: { keepAttempt?: boolean; paid?: boolean }) => {
      const id = usePaymentStore.getState().attempt?.bookingId;
      // The backend has just confirmed the charge, and a confirmed payment is
      // what releases the booking to runners. The stored copy is the create
      // response from before the customer paid, so without this the waiting
      // screen would greet them with "Waiting for your payment" until its
      // first re-read lands.
      const stored = useBookingStore.getState().activeBooking;
      if (opts?.paid && stored && stored.id === id && stored.awaiting_payment) {
        setActiveBooking({ ...stored, awaiting_payment: false, checkout_url: null });
      }
      if (!opts?.keepAttempt) resolveAttempt();
      if (id) router.replace(`/(customer)/book/confirm?bookingId=${id}`);
    },
    [resolveAttempt, router, setActiveBooking],
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Review & confirm" showBack fallbackHref="/(customer)/(tabs)">
        <View className="px-5 -mt-2 pb-3">
          <Text
            className="text-[10px] font-montserrat-bold uppercase"
            style={{ letterSpacing: 1.4, color: LightColors.textSecondary }}
          >
            New errand · Step 3
          </Text>
        </View>
      </GradientHeader>

      {/* Step indicator — clamped to the same content column as the
          scroll body so tablet edges align (mirrors type.tsx). */}
      <View className="px-5 mt-3 pb-3">
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <BookingStepIndicator currentStep={2} />
        </View>
      </View>

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
            accessibilityLabel={`Schedule: ${scheduleLabel}. ${scheduleAction}`}
            hitSlop={8}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            onPress={() =>
              // "Schedule for later" opens the picker already on "Later".
              editStep(isScheduled || needsScheduleTime ? '/(customer)/book/schedule' : '/(customer)/book/schedule?later=1')
            }
          >
            <Text className="text-[12px] font-montserrat text-textSecondary">
              Schedule
            </Text>
            <View className="flex-row items-center ml-3 flex-shrink">
              <Text className="text-[13px] font-montserrat-semi text-textPrimary flex-shrink" numberOfLines={1}>
                {scheduleLabel}
              </Text>
              <Text className="text-[13px] font-montserrat-semi text-primary ml-3">
                {scheduleAction}
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
                {Number(estimate.distance_km).toFixed(1)} km
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

        {/* Single-location errands (queue) have no travel distance, so
            vehicle pricing is identical for every option. Hide the selector
            to avoid the confusing "all vehicles cost the same" UX. */}
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

        {/* Item money — never part of the Total above and never charged
            online: the runner pays at the store and the customer repays the
            receipt amount in cash at the door, up to this budget. Said at the
            moment of commitment so a GCash/Maya payer doesn't assume the app
            covers the items too. Typographic row (not a card) so its amount
            sits in the same money column as the PriceBreakdown lines above. */}
        {rule.requiresShoppingBudget && (draftBooking.shopping_budget ?? 0) > 0 && (
          <View className="mb-4 flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-montserrat text-textSecondary">
                Items, paid in cash at the door
              </Text>
              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                Your runner pays for the items. You repay the receipt amount in
                cash when they arrive — never more than your budget, and not
                part of the total above.
              </Text>
            </View>
            <Text
              className="text-sm font-inter text-textPrimary"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              up to {formatCurrency(draftBooking.shopping_budget!)}
            </Text>
          </View>
        )}

        {/* Payment Method */}
        <PaymentMethodSelector
          selected={draftBooking.payment_method}
          // The booking charges `totalAmount` up front, so the wallet is only
          // offered when its balance covers it.
          amount={totalAmount}
          onSelect={(type) => updateDraft({ payment_method: type })}
        />

      </ScrollView>

      {/* Bottom CTA — clamped to the content column on tablets. */}
      <BottomActionBar>
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          {/* Offline pre-empt. Tapping Confirm with no connection used to
              begin a payment attempt, mount the full-screen "Creating your
              errand" ceremony, fire a doomed POST and collapse into an error
              toast. We already know we're offline, so say so instead — the
              global OfflineBanner probes /health every ~10s and re-enables
              this by itself. The flag is INFERRED from traffic and can
              false-positive, so "Try anyway" stays as the escape hatch: it
              runs the exact same handleSubmit. */}
          {showOfflineGate && (
            <View className="flex-row items-center mb-2.5">
              <WifiOff size={13} color={LightColors.textTertiary} strokeWidth={2} />
              <Text className="text-[11px] font-montserrat text-textSecondary ml-1.5 flex-1">
                You’re offline — Confirm turns back on the moment you reconnect.
              </Text>
              <Pressable
                onPress={handleSubmit}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Try booking anyway"
                accessibilityHint="Sends the booking now even though the app thinks you're offline"
                style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
              >
                <Text className="text-[12px] font-montserrat-bold text-primary ml-3">
                  Try anyway
                </Text>
              </Pressable>
            </View>
          )}
          <Button
            title={
              showOfflineGate
                ? 'Waiting for connection…'
                : currentVehicleEstimate && !isEstimateLoading
                  ? `Confirm ${formatCurrency(totalAmount)}`
                  : estimateError
                    ? 'Fare unavailable'
                    : 'Calculating fare…'
            }
            onPress={handleSubmit}
            loading={isSubmitting}
            loadingTitle="Creating booking…"
            // Don't let the user submit before the estimate has resolved —
            // without it we'd be sending a payload with an indeterminate
            // price expectation, and the server would 422 on
            // `vehicle_type_rate` validation mismatch. Offline adds the second
            // pre-empt (above).
            disabled={showOfflineGate || isEstimateLoading || !currentVehicleEstimate}
            fullWidth
          />
        </View>
      </BottomActionBar>

      {/* Full-screen create overlay — fills the multi-second create round-trip
          that previously showed only a button spinner (staged: Checking →
          Creating → Opening checkout). Mutually exclusive with PaymentProgress
          below: once the gateway verification is live, that overlay wins so the
          two Modals never stack. */}
      <BookingProgress stage={createOverlayStage} />

      {/* Honest payment verification for GCash/Maya charges. Hidden
          during 'preparing' (BookingProgress covers the create call above); it
          takes over from the gateway hand-off onward. Wallet/cash resolve
          before this ever shows. PaymentProgress announces its own stages. */}
      <PaymentProgress
        stage={paymentOverlayStage}
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
        onSuccessDone={() => leaveForBooking({ paid: true })}
        failureTitle={paymentFailure?.title}
        failureMessage={paymentFailure?.message}
        // Reopening the SAME charge (no duplicate-charge risk) only while it is
        // still alive: a backed-out checkout ("Resume payment") or one that
        // never opened ("Try again"). Once the server has ruled — declined,
        // expired, refunded — the errand is cancelled and that checkout is
        // dead, so Book again leads instead.
        onRetry={
          paymentFailure?.recovery === 'rebook'
            ? rebookAfterFailedPayment
            : attempt?.checkoutUrl
              ? retryBookingPayment
              : undefined
        }
        retryCta={
          paymentFailure?.recovery === 'rebook'
            ? 'Book again'
            : paymentFailure?.recovery === 'resume'
              ? 'Resume payment'
              : undefined
        }
        onClose={() => leaveForBooking()}
        onSafeExit={() => leaveForBooking()}
      />
    </View>
  );
}
