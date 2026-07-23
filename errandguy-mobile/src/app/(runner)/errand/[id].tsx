import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, Pressable, Linking, KeyboardAvoidingView, Platform, useWindowDimensions, Animated, PanResponder } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  MessageCircle,
  Phone,
  MapPin,
  Navigation,
  CheckCircle,
  CheckCircle2,
  Circle,
  ShoppingBag,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { JourneyBeads } from '../../../components/ui/JourneyBeads';
import { StatusTimeline } from '../../../components/ui/StatusTimeline';
import { CurrentStepHero } from '../../../components/ui/CurrentStepHero';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { BackButton } from '../../../components/ui/BackButton';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { StatusActionButton, getNextStatus } from '../../../components/runner/StatusActionButton';
import { ErrandDetailsCard } from '../../../components/runner/ErrandDetailsCard';
import { PhotoProofModal } from '../../../components/runner/PhotoProofModal';
import { ReceiptCaptureModal } from '../../../components/runner/ReceiptCaptureModal';
import { CompletionModal } from '../../../components/runner/CompletionModal';
import { RateCustomerModal } from '../../../components/runner/RateCustomerModal';
import { RunnerActiveMap } from '../../../components/runner/RunnerActiveMap';
import { Skeleton, SkeletonCircle } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';
import { SuccessCheck } from '../../../components/ui/SuccessCheck';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { useLocationStore } from '../../../stores/locationStore';
import { useSmartPolling } from '../../../hooks/useSmartPolling';
import { useBackGuard } from '../../../hooks/useBackGuard';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { useQuery } from '../../../hooks/useQuery';
import { useEta } from '../../../hooks/useEta';
import { CacheTTL } from '../../../services/cache.service';
import { runnerService } from '../../../services/runner.service';
import type { Booking } from '../../../types';
import { STATUS_LABELS } from '../../../constants/statusLabels';
import { Elevation, LightColors } from '../../../constants/colors';
import { Radius } from '../../../constants/radius';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import { formatCurrency } from '../../../utils/formatCurrency';
import type { BookingStatus } from '../../../types';
import { toast } from '../../../stores/toastStore';

const TIMELINE_STEPS: BookingStatus[] = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'delivered',
  'completed',
];

/** Statuses that mean "runner is heading to / at the pickup location".
 *  `matched` is included because the runner is assigned but hasn't yet
 *  acknowledged via 'accepted' — they are still travelling to pickup
 *  (or about to). Treating matched as dropoff phase would point the
 *  route + navigate button at the wrong location. */
const PICKUP_PHASE_STATUSES = new Set<string>([
  'matched',
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
]);

export default function ActiveErrandScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentErrand, updateErrandStatus } = useRunnerStore();
  const refreshUnread = useChatStore((s) => s.refreshUnread);
  const unreadForBooking = useChatStore(
    (s) => (id ? s.unreadByBooking[id] ?? 0 : 0),
  );

  // Refresh unread chat counts every 30s, paused when backgrounded.
  useSmartPolling(refreshUnread, { interval: 30_000, backoffOnError: false });

  // Make sure GPS streaming is running while there's an active errand,
  // even if the runner toggled offline elsewhere. Stops nothing on
  // unmount because the dashboard owns the long-lived subscription.
  const isTracking = useLocationStore((s) => s.isTracking);
  const startTracking = useLocationStore((s) => s.startTracking);
  const currentLocation = useLocationStore((s) => s.currentLocation);
  useEffect(() => {
    if (!isTracking) {
      startTracking()
        .then((ok) => {
          if (!ok) {
            toast.warning(
              'Location permission is off. Customers can\u2019t see your live position.',
            );
          }
        })
        .catch(() => {});
    }
  }, [isTracking, startTracking]);

  const [loading, setLoading] = useState(false);
  const [showPhotoProof, setShowPhotoProof] = useState<'pickup' | 'delivery' | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [deliveryPhotoUrl, setDeliveryPhotoUrl] = useState<string | null>(null);
  // Remount key for the SlideToConfirm CTA. The slider latches once it
  // completes (by design — the component can't re-arm itself), so when a
  // downstream modal is dismissed WITHOUT finishing the transition, or
  // when the status advances to the NEXT slide-gated stage, we bump this
  // key to hand the runner a fresh, un-slid control.
  const [slideResetKey, setSlideResetKey] = useState(0);
  // Brief SuccessCheck overlay after the completion submit.
  const [showSuccessMoment, setShowSuccessMoment] = useState(false);
  const [sheetRefreshing, setSheetRefreshing] = useState(false);
  // Trip details (payout, errand description, status timeline) collapse
  // by default. The runner's brain only needs the current step + the
  // ONE big action button; everything else is reference material.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Branded leave confirmation for the in-app back chevron (parity with
  // the SOS / payout / logout ConfirmModals). The Android hardware-back
  // guard keeps its own double-press toast — see useBackGuard.
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const leaveActionRef = useRef<(() => void) | null>(null);
  const reduceMotion = useReducedMotion();

  // Single source of truth: the API. The runner-facing endpoint
  // (RunnerErrandController@show) is scoped by `runnerBookings()` on
  // the server, so a 200 response is itself proof of ownership \u2014 the
  // backend will only return the booking if `runner_id === auth()->id`.
  // Mobile-side identity comparisons are unnecessary (and were the
  // source of a previous bug: the BookingResource didn't expose
  // runner_id, so booking.runner_id was always undefined and every
  // session got locked into read-only mode).
  //
  // useQuery is stale-while-revalidate against AsyncStorage, so a
  // returning runner sees their last known state synchronously on
  // mount while the network refresh happens in the background. The
  // cache key is per-booking-id, and runnerService mutations call
  // invalidateRunnerErrands() to bust it on every status update.
  const fetchedQ = useQuery<Booking | null>(
    ['runner', 'errand', 'byId', id ?? 'none'],
    async () => {
      if (!id) return null;
      const r = await runnerService.getErrand(id);
      return (r.data?.data ?? null) as Booking | null;
    },
    { staleTime: 15_000, ttl: CacheTTL.SHORT, enabled: !!id },
  );

  // Prefer the freshest source. The store-held copy from accept-time
  // can be missing relations (status_logs, errand_type) that the
  // detail endpoint includes.
  const storeMatchesUrl = currentErrand?.id === id;
  const booking: Booking | null =
    fetchedQ.data ?? (storeMatchesUrl ? currentErrand : null);

  // Mirror the latest fetched booking into the runner store so the
  // home dashboard, location store, and chat screen see the same
  // status. Strictly a downstream sync \u2014 the source of truth is
  // still the API. Avoids the previous "self-claim" race that
  // briefly hid the action button between mount and effect.
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    const fresh = fetchedQ.data;
    if (!fresh || !myUserId) return;
    const isActive = !['completed', 'cancelled', 'no_runner'].includes(fresh.status);
    const existing = useRunnerStore.getState().currentErrand;
    if (isActive) {
      if (!existing || existing.id !== fresh.id || existing.status !== fresh.status) {
        useRunnerStore.setState({ currentErrand: fresh });
      }
    } else if (existing?.id === fresh.id) {
      useRunnerStore.setState({ currentErrand: null });
    }
  }, [fetchedQ.data, myUserId]);

  // Read-only is now a function of booking state alone, not identity:
  // the API has already proved ownership by returning the booking.
  // Locked when the booking is terminal or hasn't loaded yet.
  const isReadOnly = (() => {
    if (!booking) return true;
    if (['completed', 'cancelled', 'no_runner'].includes(booking.status)) return true;
    return false;
  })();

  // Light status-sync poll. The errand screen is the runner's primary
  // workspace during a job; if the customer cancels, the admin force-
  // completes, or another mobile session advances status, we want the
  // CTA to reflect that within ~15s without burning battery.
  //
  // We fetch directly (not via fetchedQ.refresh) so we can also push the
  // result into the runner store \u2014 otherwise, when storeMatchesUrl=true
  // the screen renders from `currentErrand` and ignores fetchedQ.data
  // entirely. The fetch is cache-backed via runnerService.getErrand
  // (cacheTtlMs: 4_000) so back-to-back triggers within the cache
  // window collapse to one network call.
  const _bookingForPollGuard = booking;
  const _pollEnabled =
    !!id &&
    !!_bookingForPollGuard &&
    !['completed', 'cancelled', 'no_runner'].includes(_bookingForPollGuard.status);
  // Smart poll: reconcile status while the errand is non-terminal. Realtime
  // (useBookingStatus) is primary; this is the fallback. useSmartPolling adds
  // offline-pause + immediate reconnect/foreground tick + backoff (errors
  // propagate — no swallow-catch — so a failing reconcile backs off).
  useSmartPolling(
    async () => {
      if (!id) return;
      const r = await runnerService.getErrand(id);
      const fresh = (r?.data?.data ?? null) as Booking | null;
      if (!fresh) return;
      // Mirror into the store when this is the runner's active job so the
      // home screen + other consumers see the new status.
      const store = useRunnerStore.getState();
      if (store.currentErrand?.id === fresh.id && fresh.status !== store.currentErrand.status) {
        if (fresh.status === 'completed' || fresh.status === 'cancelled') {
          store.updateErrandStatus(fresh.status);
        } else {
          useRunnerStore.setState({ currentErrand: fresh });
        }
      }
    },
    { interval: 15_000, enabled: _pollEnabled, runOnMount: false },
  );

  // ── Hooks below MUST stay above the early-return so that the hook
  // call order is stable across the null → resolved booking transition.
  // Optional chaining keeps them safe when `booking` is still loading.
  const isTransportation = !!booking?.is_transportation;
  const errandSlug = booking?.errand_type?.slug;
  const errandRule = getErrandTypeRule(errandSlug);
  const isShoppingErrand = errandRule.requiresShoppingBudget;
  const isSingleLocation = errandRule.singleLocation;
  const isErrandActive = !!booking && !['completed', 'cancelled', 'no_runner'].includes(booking.status);
  // Android hardware-back guard: require two presses while errand is active
  // AND the runner is the assigned mutator (read-only deep link can leave freely).
  useBackGuard(isErrandActive && !isReadOnly);
  const timelineSteps = errandRule.statusFlow as unknown as BookingStatus[];
  const currentStatusIdx = booking ? timelineSteps.indexOf(booking.status) : -1;

  // Live ETA from the runner's device GPS to the active destination
  // (pickup or dropoff depending on phase). Drives the "X min away"
  // overlay on the runner's mini map and gives the runner a constant
  // sense of progress without flipping to Google Maps.
  //
  // Single-location errands (queue, bills, document) only have a
  // pickup pin — there is no dropoff leg — so we always route to the
  // pickup regardless of status. Otherwise, fall back to the dropoff
  // only after the package leaves pickup.
  const inPickupPhase =
    isSingleLocation || (booking ? PICKUP_PHASE_STATUSES.has(booking.status) : true);
  const etaTargetLat = inPickupPhase ? booking?.pickup_lat : booking?.dropoff_lat;
  const etaTargetLng = inPickupPhase ? booking?.pickup_lng : booking?.dropoff_lng;
  const runnerEta = useEta(
    currentLocation
      ? { lat: currentLocation.lat, lng: currentLocation.lng }
      : null,
    etaTargetLat != null && etaTargetLng != null
      ? { lat: Number(etaTargetLat), lng: Number(etaTargetLng) }
      : null,
  );

  // ── Auto-launch turn-by-turn when the runner enters a travel leg.
  // Triggers exactly once per status transition into `heading_to_pickup`
  // or `in_transit` so we don't fight the runner if they manually
  // close Navigate. The dismissed-status ref is keyed by booking id +
  // status string so a different booking (or the *next* travel leg
  // within the same booking) will re-trigger. Skipped while read-only
  // or when there's no destination yet. */
  const autoNavLaunchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!booking || isReadOnly) return;
    const status = booking.status;
    const isTravelLeg = status === 'heading_to_pickup' || status === 'in_transit';
    if (!isTravelLeg) return;
    const key = `${booking.id}:${status}`;
    if (autoNavLaunchedRef.current === key) return;
    // Need a destination to actually navigate to.
    const destLat = inPickupPhase ? booking.pickup_lat : booking.dropoff_lat;
    const destLng = inPickupPhase ? booking.pickup_lng : booking.dropoff_lng;
    if (destLat == null || destLng == null) return;
    autoNavLaunchedRef.current = key;
    // Small delay so the optimistic status update has painted before
    // the screen pushes \u2014 makes the transition feel intentional, not
    // jarring.
    const t = setTimeout(() => {
      router.push(`/(runner)/navigate/${booking.id}` as any);
    }, 350);
    return () => clearTimeout(t);
  }, [booking, isReadOnly, inPickupPhase, router]);

  // Verb-led, runner-POV headline for the CurrentStepHero. Phrased as
  // a directive ("Pick up the order") rather than a status label
  // ("Picked Up") so it reads as the next thing the runner needs to
  // do — not the last thing they did.
  const runnerHeroTitle: string = (() => {
    if (!booking) return '';
    if (isTransportation) {
      switch (booking.status) {
        case 'accepted':
        case 'matched':
          return 'Head to your passenger';
        case 'heading_to_pickup':
          return 'On the way to pickup';
        case 'arrived_at_pickup':
          return 'Verify the ride PIN';
        case 'picked_up':
        case 'in_transit':
          return 'Drive to drop-off';
        case 'arrived_at_dropoff':
          return 'End the ride';
        case 'delivered':
        case 'completed':
          return 'Trip complete';
        case 'cancelled':
          return 'Ride cancelled';
        default:
          return STATUS_LABELS[booking.status] ?? '';
      }
    }
    switch (booking.status) {
      case 'accepted':
      case 'matched':
        return 'Head to pickup';
      case 'heading_to_pickup':
        return 'On the way to pickup';
      case 'arrived_at_pickup':
        return isShoppingErrand ? 'Shop for the items' : 'Pick up the order';
      case 'picked_up':
      case 'in_transit':
        return isSingleLocation ? 'Complete the task' : 'On the way to drop-off';
      case 'arrived_at_dropoff':
        return 'Hand off the order';
      case 'delivered':
      case 'completed':
        return 'Errand complete';
      case 'cancelled':
        return 'Errand cancelled';
      default:
        return STATUS_LABELS[booking.status] ?? '';
    }
  })();

  const customerPhone =
    booking?.dropoff_contact_phone ??
    booking?.pickup_contact_phone ??
    booking?.customer?.phone ??
    null;
  const customerName =
    booking?.dropoff_contact_name ??
    booking?.pickup_contact_name ??
    booking?.customer?.full_name ??
    'Customer';

  const handleCallCustomer = useCallback(() => {
    if (!customerPhone) {
      toast.error('Customer phone is not available');
      return;
    }
    Linking.openURL(`tel:${customerPhone}`).catch(() =>
      toast.error('Could not start call'),
    );
  }, [customerPhone]);

  // Runner-side SOS — tap once to open confirm, again to broadcast.
  // Idempotent on the backend, so a double-tap won't stack alerts.
  const [showSOSConfirm, setShowSOSConfirm] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosActive, setSosActive] = useState<boolean>(false);
  // Sync the SOS toggle from the (possibly async) booking payload.
  useEffect(() => {
    if (booking?.sos_triggered) setSosActive(true);
  }, [booking?.sos_triggered]);

  const handleConfirmSOS = useCallback(async () => {
    if (sosLoading || !booking) return;
    setSosLoading(true);
    try {
      await runnerService.triggerSOS(booking.id);
      setSosActive(true);
      setShowSOSConfirm(false);
      toast.success('Emergency contacts notified');
    } catch {
      toast.error('Could not trigger SOS. Try again.');
    } finally {
      setSosLoading(false);
    }
  }, [booking, sosLoading]);

  const handleStatusUpdate = async () => {
    if (!booking) return;
    const nextStatus = getNextStatus(booking.status, errandSlug);
    if (!nextStatus) return;

    // Shopping errands: capture receipt + actual cost when transitioning into picked_up.
    if (booking.status === 'arrived_at_pickup' && isShoppingErrand) {
      setShowReceipt(true);
      return;
    }

    // Photo proof at pickup (non-shopping, non-transport item errands)
    if (
      booking.status === 'arrived_at_pickup' &&
      !isTransportation &&
      !isShoppingErrand &&
      !isSingleLocation
    ) {
      setShowPhotoProof('pickup');
      return;
    }

    // Single-location errands jump from picked_up straight to completed —
    // no parcel handover, no signature. Show the completion modal so the
    // runner can leave a note + (optional) photo of the completed task.
    if (isSingleLocation && booking.status === 'picked_up') {
      setShowCompletion(true);
      return;
    }

    // Completion modal at delivery/arrived_at_dropoff (multi-location errands)
    if (booking.status === 'arrived_at_dropoff') {
      setShowPhotoProof('delivery');
      return;
    }

    if (booking.status === 'delivered') {
      setShowCompletion(true);
      return;
    }

    await advanceStatus(nextStatus);
  };

  // Optimistic status advance.
  // Strategy: flip the local cached booking + runner store FIRST so the
  // CTA, timeline, and map phase update on the next frame. Then fire
  // the network request in the background. On failure, snap back and
  // surface a toast — the runner doesn't see a spinner sitting on the
  // CTA while the photo uploads (which is what made the screen feel
  // sluggish, especially over LTE).
  //
  // For transitions that require a file (picked_up/pickup_photo,
  // delivered/delivery_photo, completed/signature) we pass the local
  // file URI through as part of the SAME request — sending the status
  // and uploading the photo separately fails the backend validator.
  const advanceStatus = async (
    status: string,
    opts?: {
      pickupPhoto?: string | null;
      deliveryPhoto?: string | null;
      signature?: string | null;
    },
  ) => {
    if (!booking) return;
    const prev = booking;
    const nowIso = new Date().toISOString();
    const optimistic: Booking = {
      ...prev,
      status: status as BookingStatus,
      ...(opts?.pickupPhoto ? { pickup_photo_url: opts.pickupPhoto } : {}),
      ...(opts?.deliveryPhoto ? { delivery_photo_url: opts.deliveryPhoto } : {}),
      ...(opts?.signature && opts.signature.startsWith('file')
        ? { signature_url: opts.signature }
        : {}),
      ...(status === 'picked_up' && !prev.picked_up_at
        ? { picked_up_at: nowIso }
        : {}),
      ...(status === 'completed' && !prev.completed_at
        ? { completed_at: nowIso }
        : {}),
    };
    // Update the SWR cache so the screen re-renders immediately, and
    // mirror into the runner store so the home dashboard + chat header
    // see the new status without waiting on the next 15s poll.
    fetchedQ.mutate(optimistic);
    updateErrandStatus(status as BookingStatus);

    runnerService
      .advanceErrandStatus(booking.id, status, opts)
      .then(() => {
        // Server-confirmed transition — success tick. The `completed`
        // flip is skipped because the SuccessCheck overlay fires its own
        // success haptic (avoid a double buzz).
        if (status !== 'completed') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        // Only open the rate modal AFTER the server confirms the status
        // flip to `completed`. Opening it on the optimistic update used
        // to fire POST /runner/errand/{id}/review while the booking row
        // was still mid-transition on the server, which BookingPolicy
        // correctly rejected with a 403 (status !== completed). The
        // race surfaced as a noisy "❌ 403 … review" log on every
        // completion.
        if (status === 'completed') {
          setShowRate(true);
        }
      })
      .catch((err: any) => {
        // Revert optimistic state and surface the error.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        if (status === 'completed') setShowSuccessMoment(false);
        setSlideResetKey((k) => k + 1);
        fetchedQ.mutate(prev);
        updateErrandStatus(prev.status as BookingStatus);
        toast.error(err?.message ?? err?.response?.data?.message ?? 'Failed to update status');
      });
  };

  const handlePhotoConfirm = async (uri: string) => {
    const phase = showPhotoProof;
    setShowPhotoProof(null);
    if (phase === 'delivery') {
      // Flow: mark `delivered` (uploads delivery_photo) → open the
      // completion sheet so the runner can capture the signature and
      // advance to `completed`. The two transitions used to be merged
      // into a single `completed` call which dropped the delivery
      // photo on the floor; the picked_up case suffered the same
      // bug (status sent without the captured photo → 422).
      setDeliveryPhotoUrl(uri);
      await advanceStatus('delivered', { deliveryPhoto: uri });
      setShowCompletion(true);
      return;
    }
    // Pickup phase: pass the captured photo through to the backend.
    await advanceStatus('picked_up', { pickupPhoto: uri });
  };

  const handleCompletionConfirm = async (signatureUri: string) => {
    setShowCompletion(false);
    // Celebrate the finish — SuccessCheck fires its own success haptic
    // and auto-dismisses via onDone. Reverted by advanceStatus's catch
    // if the server rejects the transition.
    setShowSuccessMoment(true);
    // Only forward signature when it looks like a real file URI; the
    // CompletionModal currently emits 'signature_placeholder' which
    // would 422 on the backend's `image` rule. Pre-existing limitation
    // — leaves transport/single-location flows working untouched.
    const sig = signatureUri && signatureUri.startsWith('file') ? signatureUri : null;
    await advanceStatus('completed', { signature: sig });
  };

  const handleVerifyPin = async () => {
    if (pinInput.length !== 4 || !booking) return;
    setLoading(true);
    try {
      // Hit the dedicated PIN endpoint — NOT the generic status updater.
      // The server validates the 4-digit code against booking.ride_pin,
      // tracks attempts, and flips ride_pin_verified on success.
      await runnerService.verifyRidePin(booking.id, pinInput);
      setPinVerified(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success('PIN verified — ride may begin');
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast.error(err?.message ?? err?.response?.data?.message ?? 'Incorrect PIN. Please try again.');
      setPinInput('');
    } finally {
      setLoading(false);
    }
  };

  const handleRateSubmit = async (rating: number, comment: string) => {
    setShowRate(false);
    if (!booking) {
      router.replace('/(runner)/(tabs)' as any);
      return;
    }
    try {
      await runnerService.submitCustomerReview(booking.id, rating, comment);
      toast.success('Thanks for your feedback');
    } catch (err: any) {
      // Don't block the runner from leaving the screen on failure — their
      // shift continues. Most common 422 here is "already reviewed".
      const msg = err?.response?.data?.message;
      if (msg && err?.response?.status !== 422) {
        toast.error(msg);
      }
    } finally {
      router.replace('/(runner)/(tabs)' as any);
    }
  };

  const handleRateSkip = () => {
    setShowRate(false);
    router.replace('/(runner)/(tabs)' as any);
  };

  // Sheet height snap points. The sheet is now an absolutely-positioned
  // overlay on top of the full-screen map (instead of a flex sibling),
  // so the runner can drag it up to read details or down to peek the
  // map. Snap targets keep gestures predictable; intermediate heights
  // are interpolated continuously while the finger is down.
  const WIN_H = useWindowDimensions().height;
  // Bottom safe-area inset — the sheet is lifted above the home indicator
  // by a bottom-inset spacer, so the map's floating controls (ETA pill +
  // recenter) must clear sheetHeight + inset, not sheetHeight alone.
  // Otherwise the recenter button hides behind the sheet on notch /
  // home-indicator devices.
  const insets = useSafeAreaInsets();
  const SNAP_MID = Math.round(WIN_H * 0.55);        // expanded for details
  const SNAP_EXPANDED = Math.round(WIN_H * 0.88);   // near full-screen

  // The collapsed snap is DERIVED from the measured fixed chrome (drag
  // handle + header block + sticky CTA block), not a hardcoded 220. A
  // fixed 220 clipped the CTA below the screen edge whenever the chrome
  // exceeded it — worst at the completion step, where the checklist
  // grows the CTA block. Measuring guarantees the collapsed height
  // always contains the full CTA (+ a small scroll peek) at every
  // device size, so THE action button is never off-screen on mount.
  const FALLBACK_COLLAPSED = 300;                   // safe until measured
  const SHEET_PEEK = 14;                            // sliver of scroll hint
  const [handleH, setHandleH] = useState(0);
  const [headerH, setHeaderH] = useState(0);
  const [ctaH, setCtaH] = useState(0);
  const fixedChromeH = handleH + headerH + ctaH;
  const SNAP_COLLAPSED = useMemo(() => {
    if (!fixedChromeH) return Math.min(FALLBACK_COLLAPSED, SNAP_EXPANDED);
    return Math.min(fixedChromeH + SHEET_PEEK, SNAP_EXPANDED);
  }, [fixedChromeH, SNAP_EXPANDED]);
  // Snap targets, sorted and clamped so none ever sits BELOW the
  // collapsed floor (which would re-clip the CTA once the completion
  // checklist pushes collapsed past SNAP_MID).
  const SNAPS = useMemo(() => {
    const arr = Array.from(new Set([SNAP_COLLAPSED, SNAP_MID, SNAP_EXPANDED]))
      .filter((v) => v >= SNAP_COLLAPSED && v <= SNAP_EXPANDED)
      .sort((a, b) => a - b);
    return arr.length ? arr : [SNAP_COLLAPSED];
  }, [SNAP_COLLAPSED, SNAP_MID, SNAP_EXPANDED]);

  // Default to the COLLAPSED snap so the map dominates the screen on
  // mount — the runner's primary need is "where am I going" not "what
  // are the trip details". The sticky CTA at the bottom of the sheet
  // keeps the next action one tap away regardless of snap height.
  const sheetHeight = useRef(new Animated.Value(FALLBACK_COLLAPSED)).current;
  const sheetHeightStartRef = useRef<number>(FALLBACK_COLLAPSED);
  const currentSheetHeightRef = useRef<number>(FALLBACK_COLLAPSED);
  // Refs so the once-created PanResponder reads the LATEST measured
  // snap bounds instead of the values captured at creation.
  const snapsRef = useRef(SNAPS);
  const snapCollapsedRef = useRef(SNAP_COLLAPSED);
  const snapExpandedRef = useRef(SNAP_EXPANDED);
  // Once the runner drags the sheet themselves, stop auto-pinning it to
  // the collapsed height so we never fight their intent.
  const userMovedRef = useRef(false);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  useEffect(() => {
    snapsRef.current = SNAPS;
    snapCollapsedRef.current = SNAP_COLLAPSED;
    snapExpandedRef.current = SNAP_EXPANDED;
  }, [SNAPS, SNAP_COLLAPSED, SNAP_EXPANDED]);

  // Track the current sheet height in a ref so the pan responder can
  // resume drags from wherever the sheet currently sits. No state
  // mirror is needed \u2014 the old Navigate FAB that depended on it has
  // been moved inside the sheet.
  useEffect(() => {
    const id = sheetHeight.addListener(({ value }) => {
      currentSheetHeightRef.current = value;
    });
    return () => sheetHeight.removeListener(id);
  }, [sheetHeight]);

  // Offset for the map's floating controls (ETA pill + recenter). They
  // ride just above the sheet's top edge by tracking sheetHeight, but
  // that travel is capped at the mid snap (or the resting collapsed
  // height, whichever is taller). Without the cap, dragging the sheet to
  // full expansion lifts the controls into the floating top-bar card on
  // the shortest devices (SE 667). Past the cap they hold position and
  // slide behind the rising sheet — where the map is hidden anyway, so
  // there is nothing to recenter or ETA against.
  const mapControlsOffset = useMemo(() => {
    const cap = Math.max(SNAP_MID, SNAP_COLLAPSED);
    return Animated.add(
      sheetHeight.interpolate({
        inputRange: [0, cap, cap + 1],
        outputRange: [0, cap, cap],
        extrapolate: 'clamp',
      }),
      new Animated.Value(insets.bottom + 12),
    );
  }, [sheetHeight, SNAP_MID, SNAP_COLLAPSED, insets.bottom]);

  const snapTo = useCallback((target: number) => {
    // Reduce Motion: snap instantly instead of springing (matches the
    // shared ExpandableSheet's reduced-motion behaviour).
    if (reduceMotionRef.current) {
      sheetHeight.setValue(target);
      currentSheetHeightRef.current = target;
      return;
    }
    Animated.spring(sheetHeight, {
      toValue: target,
      useNativeDriver: false,
      bounciness: 4,
      speed: 14,
    }).start(() => {
      currentSheetHeightRef.current = target;
    });
  }, [sheetHeight]);

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture for vertical drags so the sticky CTA
      // and inner ScrollView still work normally.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        userMovedRef.current = true;
        sheetHeightStartRef.current = currentSheetHeightRef.current;
      },
      onPanResponderMove: (_e, g) => {
        // Drag UP increases height (dy negative); DOWN decreases.
        const next = Math.max(snapCollapsedRef.current, Math.min(snapExpandedRef.current, sheetHeightStartRef.current - g.dy));
        sheetHeight.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const projected = sheetHeightStartRef.current - g.dy - g.vy * 80;
        // Snap to the nearest (measured) snap point.
        const snaps = snapsRef.current;
        let nearest = snaps[0];
        let bestDelta = Infinity;
        for (const s of snaps) {
          const d = Math.abs(s - projected);
          if (d < bestDelta) { bestDelta = d; nearest = s; }
        }
        snapTo(nearest);
      },
    }),
  ).current;

  // Keep the sheet's default height honest: pin it to the measured
  // collapsed height (so the CTA + its completion checklist are always
  // fully visible) until the runner drags it themselves. And when a
  // step gates the CTA behind sub-UI that lives in the scroll area
  // (transportation PIN entry), reveal it once by snapping to mid so
  // the field isn't hidden behind a dead-looking disabled button.
  const autoSnapStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!booking) return;
    const status = booking.status;
    const needsPinReveal =
      isTransportation &&
      status === 'arrived_at_pickup' &&
      !pinVerified &&
      !booking.ride_pin_verified;
    if (needsPinReveal) {
      if (autoSnapStatusRef.current !== status) {
        autoSnapStatusRef.current = status;
        userMovedRef.current = true; // don't let the collapsed pin fight the reveal
        snapTo(Math.max(SNAP_MID, snapCollapsedRef.current));
      }
      return;
    }
    if (!userMovedRef.current && Math.abs(currentSheetHeightRef.current - SNAP_COLLAPSED) > 2) {
      snapTo(SNAP_COLLAPSED);
    }
  }, [booking?.status, isTransportation, pinVerified, booking?.ride_pin_verified, SNAP_COLLAPSED, SNAP_MID, snapTo]);

  // Shopping errands: the tickable list IS the runner's core reference,
  // so open the Trip-details disclosure once on load (the ErrandDetailsCard
  // itself also defaults expanded for shopping) — this drops the picking
  // list from three disclosures deep to reachable with just a sheet drag.
  const shoppingAutoOpenRef = useRef(false);
  useEffect(() => {
    if (isShoppingErrand && !shoppingAutoOpenRef.current) {
      shoppingAutoOpenRef.current = true;
      setDetailsOpen(true);
    }
  }, [isShoppingErrand]);

  // ── Early-return guard MUST stay below every hook above so the hook
  // call order is identical between the loading and resolved renders.
  // Putting this gate higher caused the “Rendered more hooks than during
  // the previous render” crash when fetchedQ.data flipped from null to a
  // resolved booking object.
  if (!booking) {
    if (fetchedQ.loading) {
      // Skeleton mirrors the real layout: map background + top bar +
      // bottom sheet (beads, hero, action row, customer pill, CTA), so
      // the resolved screen doesn't jump when the booking arrives.
      return (
        <SafeAreaView className="flex-1 bg-surfaceMuted" edges={['top']}>
          <View className="px-4 pt-2">
            <Skeleton width="100%" height={56} borderRadius={16} />
          </View>
          <View className="flex-1" />
          <View className="bg-surface rounded-t-3xl px-5 pt-4 pb-6">
            <View className="items-center mb-4">
              <Skeleton width={40} height={4} borderRadius={2} />
            </View>
            <Skeleton width="55%" height={12} style={{ marginBottom: 12 }} />
            <Skeleton width="80%" height={20} style={{ marginBottom: 8 }} />
            <Skeleton width="65%" height={12} style={{ marginBottom: 16 }} />
            <View className="flex-row mb-4" style={{ gap: 8 }}>
              <Skeleton width="60%" height={44} borderRadius={12} />
              <Skeleton width="35%" height={44} borderRadius={12} />
            </View>
            <View className="flex-row items-center mb-4">
              <SkeletonCircle size={44} />
              <View className="flex-1 ml-3">
                <Skeleton width="50%" height={14} style={{ marginBottom: 6 }} />
                <Skeleton width="35%" height={10} />
              </View>
              <SkeletonCircle size={40} style={{ marginRight: 8 }} />
              <SkeletonCircle size={40} />
            </View>
            <Skeleton width="100%" height={56} borderRadius={14} />
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView className="flex-1 bg-background justify-center px-4" edges={['top']}>
        <ErrorState
          title="Errand unavailable"
          description="This errand is no longer accessible. It may have been reassigned or removed."
          onRetry={() => fetchedQ.refresh()}
          style={{ flex: 0 }}
        />
        <View className="items-center pb-10">
          <Button title="Go Back" variant="outline" onPress={() => router.canGoBack() ? router.back() : router.replace('/(runner)/(tabs)')} />
        </View>
      </SafeAreaView>
    );
  }

  // Next transition for the sticky CTA — drives the slide-vs-tap helper
  // caption and the pre-completion checklist. Plain derived values (no
  // hooks), so they're safe below the early-return guard.
  const nextStatusForCta = getNextStatus(booking.status, errandSlug);
  const ctaIsSlide =
    nextStatusForCta === 'delivered' || nextStatusForCta === 'completed';

  // Pre-completion checklist: read-only recap of what proof has been
  // captured so the runner sees what's missing BEFORE sliding to
  // complete. Derived entirely from existing booking fields.
  const completionChecklist: { key: string; label: string; done: boolean; note?: string }[] = [];
  if (!isReadOnly && nextStatusForCta === 'completed') {
    if (!isTransportation && !isSingleLocation) {
      completionChecklist.push({
        key: 'delivery_photo',
        label: 'Delivery photo',
        done: !!(booking.delivery_photo_url || deliveryPhotoUrl),
      });
    }
    if (isShoppingErrand) {
      completionChecklist.push({
        key: 'receipt',
        label: 'Purchase receipt',
        done: !!booking.receipt_photo_url,
      });
    }
    if (isTransportation) {
      completionChecklist.push({
        key: 'pin',
        label: 'Ride PIN verified',
        done: pinVerified || !!booking.ride_pin_verified,
      });
    }
    if (!isTransportation && !isSingleLocation) {
      completionChecklist.push({
        key: 'signature',
        label: 'Customer signature',
        done: !!booking.signature_url,
        note: booking.signature_url ? undefined : 'captured at completion',
      });
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      <View style={{ flex: 1, position: 'relative' }}>
        {/* ── Map fills the entire screen as the background ────── */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <RunnerActiveMap
            variant="fill"
            pickupLat={booking.pickup_lat}
            pickupLng={booking.pickup_lng}
            dropoffLat={booking.dropoff_lat}
            dropoffLng={booking.dropoff_lng}
            inPickupPhase={inPickupPhase}
            singleLocation={isSingleLocation}
            etaMinutes={runnerEta.minutes}
            bottomOffset={mapControlsOffset}
          />
        </View>

        {/* Floating top bar \u2014 single cohesive card. Replaces the old
            three-pill arrangement. Back chevron, ride/errand label +
            booking number, then a separator and chat icon on the right. */}
        <SafeAreaView
          edges={['top']}
          pointerEvents="box-none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        >
          <View className="px-4 pt-2" pointerEvents="box-none">
            <View
              className="flex-row items-stretch bg-surface rounded-2xl"
              style={Elevation.md}
            >
              <View className="w-12 items-center justify-center">
                <BackButton
                  fallbackHref="/(runner)/(tabs)"
                  accessibilityHint={isErrandActive ? 'Confirms before leaving the active errand' : undefined}
                  onPress={() => {
                    const goBack = () =>
                      router.canGoBack() ? router.back() : router.replace('/(runner)/(tabs)');
                    if (isErrandActive) {
                      leaveActionRef.current = goBack;
                      setShowLeaveConfirm(true);
                    } else {
                      goBack();
                    }
                  }}
                />
              </View>
              <View className="flex-1 py-2.5 pr-3 justify-center">
                <Text
                  className="text-[14px] font-montserrat-bold text-textPrimary"
                  numberOfLines={1}
                >
                  {isTransportation ? 'Passenger ride' : 'Active errand'}
                </Text>
                <Text
                  className="text-[11px] font-inter text-textTertiary mt-0.5"
                  style={{ letterSpacing: 0.4 }}
                >
                  {booking.booking_number}
                </Text>
              </View>
              <View className="flex-row items-center pr-3">
                {/* Always-visible emergency SOS — reachable in one tap
                    regardless of sheet/disclosure state. Keeps the exact
                    two-step arm (warning haptic) → ConfirmModal broadcast;
                    only the reachability changed. */}
                {!isReadOnly && isErrandActive && (
                  <Pressable
                    onPress={() => {
                      if (sosActive) return;
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                      setShowSOSConfirm(true);
                    }}
                    disabled={sosActive || sosLoading}
                    accessibilityRole="button"
                    accessibilityLabel={sosActive ? 'SOS already triggered' : 'Trigger emergency SOS'}
                    hitSlop={6}
                    className={`w-10 h-10 rounded-full items-center justify-center ${
                      sosActive ? 'bg-danger' : 'bg-danger/10'
                    }`}
                  >
                    <ShieldAlert
                      size={20}
                      color={sosActive ? LightColors.textInverse : LightColors.dangerDark}
                      strokeWidth={2}
                    />
                  </Pressable>
                )}
                <View className="w-px h-7 bg-divider mx-2" />
                <Pressable
                  onPress={() => router.push(`/(runner)/chat/${booking.id}` as any)}
                  className="w-10 h-10 items-center justify-center"
                  accessibilityRole="button"
                  accessibilityLabel="Open chat with customer"
                  hitSlop={6}
                >
                  <MessageCircle size={20} color={LightColors.textPrimary} strokeWidth={1.8} />
                  {unreadForBooking > 0 && (
                    <View className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 bg-danger rounded-full items-center justify-center border-[1.5px] border-surface">
                      <Text className="text-[9px] text-white font-montserrat-bold leading-[12px]">
                        {unreadForBooking > 9 ? '9+' : String(unreadForBooking)}
                      </Text>
                    </View>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </SafeAreaView>

        {/* ── Draggable bottom sheet (absolute overlay) ────────── */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          // Floating-header errand sheet: a non-zero offset on iOS
          // keeps the receipt amount / proof note / chat composer
          // visible above the keyboard. Bumped to 140 to match the
          // customer details flow — 90 wasn't enough on phones with a
          // taller keyboard suggestion bar.
          keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 0}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
        >
          <Animated.View
            className="bg-surface"
            style={{
              height: sheetHeight,
              borderTopLeftRadius: Radius.sheet,
              borderTopRightRadius: Radius.sheet,
              // Sheet lift on the shared Elevation.lg scale, but with an
              // UPWARD offset so the shadow reads above the sheet's top
              // edge (a bottom sheet can't cast its shadow downward).
              ...Elevation.lg,
              shadowOffset: { width: 0, height: -3 },
            }}
          >
            {/* Drag handle \u2014 expand the touch target above + below the
                pill so the runner doesn't have to hit a 4px line. */}
            <View
              {...panResponder.panHandlers}
              onLayout={(e) => setHandleH(e.nativeEvent.layout.height)}
              className="items-center pt-2 pb-3"
              accessibilityRole="adjustable"
              accessibilityLabel="Details panel"
              accessibilityHint="Adjust to expand or collapse trip details"
              accessibilityActions={[
                { name: 'increment', label: 'Expand details' },
                { name: 'decrement', label: 'Collapse details' },
              ]}
              onAccessibilityAction={(e) => {
                userMovedRef.current = true;
                const snaps = snapsRef.current;
                const cur = currentSheetHeightRef.current;
                if (e.nativeEvent.actionName === 'increment') {
                  const next = snaps.find((s) => s > cur + 2);
                  snapTo(next ?? snaps[snaps.length - 1]);
                } else if (e.nativeEvent.actionName === 'decrement') {
                  const below = snaps.filter((s) => s < cur - 2);
                  snapTo(below.length ? below[below.length - 1] : snaps[0]);
                }
              }}
            >
              <View className="w-10 h-1 rounded-full bg-dividerStrong" />
            </View>

            {/* Header line — always visible.

                Replaces the old multi-row "Heading to / Status:" header
                with a richer 2-tier strip:
                  1. Journey beads — full-trip context at a glance.
                  2. CurrentStepHero — verb-led "do this now" headline
                     with the address as subtitle and an inline
                     "Open Maps" affordance (tap address to launch the
                     OS maps app for traffic/alternate-route checks). */}
            <View
              className="px-5 pb-2"
              onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
            >
              <JourneyBeads status={booking.status} showLabel={false} />
              <View className="mt-2">
                <CurrentStepHero
                  eyebrow={inPickupPhase ? 'PICKUP' : 'DROP-OFF'}
                  title={runnerHeroTitle}
                  subtitle={(inPickupPhase
                    ? booking.pickup_address ?? errandRule.pickupLabel
                    : booking.dropoff_address ?? errandRule.dropoffLabel) ?? undefined}
                  etaMinutes={runnerEta.minutes != null ? Math.max(1, Math.round(runnerEta.minutes)) : null}
                  accent={booking.status === 'cancelled' ? 'danger' : 'brand'}
                />
                {/* Action row — Navigate (primary, in-app turn-by-turn)
                    + Maps (secondary, system maps fallback). Lives
                    INSIDE the sheet so it scrolls with the hero and
                    never overlaps the sheet edge like the old floating
                    FAB did. Hidden in read-only / non-active states. */}
                {!isReadOnly && isErrandActive && (
                  <View className="flex-row gap-2 mt-3">
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                        router.push(`/(runner)/navigate/${booking.id}` as any);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Open turn-by-turn navigation"
                      className="flex-1 h-11 rounded-xl bg-primary flex-row items-center justify-center"
                    >
                      <Navigation size={16} color={LightColors.textInverse} strokeWidth={2.2} />
                      <Text className="text-white text-[13px] font-montserrat-bold ml-2">
                        Navigate
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                        const lat = inPickupPhase ? booking.pickup_lat : booking.dropoff_lat;
                        const lng = inPickupPhase ? booking.pickup_lng : booking.dropoff_lng;
                        if (lat == null || lng == null) {
                          toast.error('Address coordinates are missing');
                          return;
                        }
                        const url = Platform.OS === 'ios'
                          ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
                          : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
                        Linking.openURL(url).catch(() => toast.error('Could not open maps'));
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Open in system maps"
                      className="h-11 px-4 rounded-xl border border-dividerStrong bg-surfaceMuted flex-row items-center justify-center"
                    >
                      <MapPin size={15} color={LightColors.textPrimary} strokeWidth={1.8} />
                      <Text className="text-textPrimary text-[13px] font-montserrat-semi ml-1.5">
                        Maps
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>

            {/* Scrollable details — clean Uber-style hierarchy:
                  1. Customer pill (avatar + name + circular call/chat)
                  2. PIN gate (transportation only, when needed)
                  3. Payout strip (always visible — the runner's "why")
                  4. Trip details disclosure (errand brief, shopping
                     budget, timeline, SOS, report-issue) */}
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl
                  refreshing={sheetRefreshing}
                  onRefresh={async () => {
                    setSheetRefreshing(true);
                    try {
                      await fetchedQ.refresh();
                    } finally {
                      setSheetRefreshing(false);
                    }
                  }}
                />
              }
            >
              {/* ── Customer pill ─────────────────────────────── */}
              <View className="flex-row items-center bg-surface border border-divider rounded-2xl p-3 mb-3">
                <Avatar name={customerName} size="md" />
                <View className="flex-1 ml-3 mr-2">
                  <Text
                    className="text-[14px] font-montserrat-bold text-textPrimary"
                    numberOfLines={1}
                  >
                    {customerName}
                  </Text>
                  <Text
                    className="text-[11px] font-montserrat text-textTertiary mt-0.5"
                    numberOfLines={1}
                  >
                    {customerPhone ?? 'Phone unavailable'}
                  </Text>
                </View>
                <Pressable
                  onPress={handleCallCustomer}
                  disabled={!customerPhone}
                  accessibilityRole="button"
                  accessibilityLabel="Call customer"
                  hitSlop={6}
                  className={`w-10 h-10 rounded-full items-center justify-center mr-2 ${
                    customerPhone ? 'bg-primaryLight' : 'bg-surfaceMuted'
                  }`}
                >
                  <Phone size={17} color={customerPhone ? LightColors.primary : LightColors.textMuted} strokeWidth={2} />
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/(runner)/chat/${booking.id}` as any)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    unreadForBooking > 0
                      ? `Open chat, ${unreadForBooking} unread`
                      : 'Open chat with customer'
                  }
                  hitSlop={6}
                  className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center"
                >
                  <MessageCircle size={17} color={LightColors.primary} strokeWidth={2} />
                  {unreadForBooking > 0 && (
                    <View className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 bg-danger rounded-full items-center justify-center border-[1.5px] border-surface">
                      <Text className="text-[9px] text-white font-montserrat-bold leading-[12px]">
                        {unreadForBooking > 9 ? '9+' : String(unreadForBooking)}
                      </Text>
                    </View>
                  )}
                </Pressable>
              </View>

              {/* ── PIN verification (transportation pickup) ──── */}
              {isTransportation && booking.status === 'arrived_at_pickup' && !pinVerified && (
                <View className="bg-warning/10 border border-warning/40 rounded-2xl p-4 mb-3">
                  <Text className="text-[13px] font-montserrat-bold text-textPrimary mb-1">
                    Verify ride PIN
                  </Text>
                  <Text className="text-[11px] font-montserrat text-textSecondary mb-3">
                    Ask the passenger to share their 4-digit PIN.
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      className="flex-1 bg-surface border border-divider rounded-xl px-4 py-3 text-center text-xl font-inter-semi text-textPrimary tracking-[12px]"
                      value={pinInput}
                      onChangeText={(t) => setPinInput(t.replace(/\D/g, '').slice(0, 4))}
                      keyboardType="number-pad"
                      maxLength={4}
                      placeholder="• • • •"
                      placeholderTextColor={LightColors.textMuted}
                      accessibilityLabel="Trip PIN"
                      onFocus={() => {
                        // Give the field maximum clearance above the
                        // keyboard so it's never hidden while typing.
                        userMovedRef.current = true;
                        snapTo(SNAP_EXPANDED);
                      }}
                    />
                    <Button
                      title="Verify"
                      onPress={handleVerifyPin}
                      disabled={pinInput.length !== 4}
                      size="sm"
                    />
                  </View>
                </View>
              )}
              {pinVerified && isTransportation && (
                <View className="mb-3 flex-row items-center gap-2 bg-successSoft px-3 py-2.5 rounded-xl">
                  <CheckCircle size={16} color={LightColors.success} />
                  <Text className="text-[12px] font-montserrat-bold text-successDark">
                    PIN verified — ready to start
                  </Text>
                </View>
              )}

              {/* ── Payout strip (always visible) ─────────────── */}
              <View className="flex-row items-center justify-between bg-surface border border-divider rounded-2xl px-4 py-3 mb-3">
                <View>
                  <Text className="text-[10px] font-montserrat-bold uppercase text-textTertiary" style={{ letterSpacing: 1 }}>
                    Your payout
                  </Text>
                  {booking.runner_payout != null ? (
                    <Text className="text-[18px] font-inter-semi tabular-nums text-textPrimary mt-0.5">
                      {formatCurrency(booking.runner_payout)}
                    </Text>
                  ) : (
                    // Never present total_amount (customer charge incl. item
                    // cost / platform fee) as the runner's take-home.
                    <Text className="text-[15px] font-montserrat-semi text-textTertiary mt-0.5">
                      Payout pending
                    </Text>
                  )}
                </View>
                {isShoppingErrand && booking.shopping_budget != null && (
                  <View className="items-end">
                    <Text className="text-[10px] font-montserrat-bold uppercase text-warningDark" style={{ letterSpacing: 1 }}>
                      Budget
                    </Text>
                    <Text className="text-[14px] font-inter-semi tabular-nums text-warningDark mt-0.5">
                      {formatCurrency(booking.shopping_budget)}
                    </Text>
                  </View>
                )}
              </View>

              {/* ── Trip details disclosure ───────────────────── */}
              <Pressable
                onPress={() => setDetailsOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={detailsOpen ? 'Hide trip details' : 'Show trip details'}
                hitSlop={6}
                className="flex-row items-center justify-between py-2"
              >
                <Text className="text-[11px] font-montserrat-bold uppercase text-textSecondary" style={{ letterSpacing: 1.4 }}>
                  Trip details
                </Text>
                {detailsOpen ? (
                  <ChevronUp size={14} color={LightColors.textTertiary} />
                ) : (
                  <ChevronDown size={14} color={LightColors.textTertiary} />
                )}
              </Pressable>

              {detailsOpen && (
                <View className="mt-2">
                  {isShoppingErrand && booking.shopping_budget != null && (
                    <View className="bg-warningLight border border-warningSoft rounded-xl p-3 mb-3 flex-row gap-2">
                      <ShoppingBag size={14} color={LightColors.warning} />
                      <Text className="flex-1 text-[11px] font-montserrat text-textSecondary leading-[15px]">
                        Don't exceed {formatCurrency(booking.shopping_budget)}. Capture the receipt at pickup — the customer is charged the actual cost.
                      </Text>
                    </View>
                  )}

                  <View className="mb-3">
                    <ErrandDetailsCard
                      bookingId={booking.id}
                      description={booking.description}
                      specialInstructions={booking.special_instructions}
                      itemPhotos={booking.item_photos}
                      estimatedItemValue={booking.estimated_item_value}
                      shoppingItems={booking.shopping_items}
                    />
                  </View>

                  <Text className="text-[10px] font-montserrat-bold text-textTertiary mb-3 uppercase" style={{ letterSpacing: 1.2 }}>
                    Progress
                  </Text>
                  <View className="mb-3">
                    <StatusTimeline
                      steps={timelineSteps.map((step, idx) => ({
                        label: STATUS_LABELS[step] ?? step,
                        status:
                          idx < currentStatusIdx
                            ? ('completed' as const)
                            : idx === currentStatusIdx
                            ? ('current' as const)
                            : ('pending' as const),
                      }))}
                    />
                  </View>

                  {/* Emergency SOS lives in the floating top bar now so
                      it's reachable in one tap during a real emergency —
                      it is no longer nested inside this collapsed
                      disclosure. */}

                  <Pressable
                    onPress={() => {
                      const subject = encodeURIComponent(`Issue with errand ${booking.booking_number ?? booking.id}`);
                      Linking.openURL(`mailto:support@errandguy.app?subject=${subject}`).catch(() =>
                        toast.error('Could not open email app'),
                      );
                    }}
                    accessibilityRole="link"
                    accessibilityLabel="Report an issue with this errand"
                    hitSlop={8}
                    className="flex-row items-center self-start gap-1.5 py-2"
                  >
                    <AlertTriangle size={12} color={LightColors.textMuted} />
                    <Text className="text-[11px] font-montserrat-semi text-textTertiary underline">
                      Report an issue
                    </Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
            {/* Sticky action button — always visible at bottom of sheet.
                This is THE in-system action: tapping it calls
                POST /runner/errand/{id}/status which advances the
                booking, fires BookingStatusChanged, broadcasts via
                Supabase Realtime, and is mirrored on the customer
                tracking screen within ~5s. */}
            {!isReadOnly ? (
              <View
                className="px-5 pt-3 pb-3 border-t border-divider bg-surface"
                onLayout={(e) => setCtaH(e.nativeEvent.layout.height)}
              >
                {/* Pre-completion checklist — read-only recap of captured
                    proof so the runner sees what's missing before the
                    final slide. */}
                {completionChecklist.length > 0 && (
                  <View className="bg-surfaceMuted rounded-xl px-3 py-2.5 mb-2.5">
                    <Text
                      className="text-[10px] font-montserrat-bold text-textTertiary uppercase mb-1"
                      style={{ letterSpacing: 1 }}
                    >
                      Before you complete
                    </Text>
                    {completionChecklist.map((item) => (
                      <View
                        key={item.key}
                        className="flex-row items-center py-0.5"
                        accessible
                        accessibilityLabel={`${item.label}: ${item.done ? 'captured' : 'not captured'}`}
                      >
                        {item.done ? (
                          <CheckCircle2 size={16} color={LightColors.success} strokeWidth={2.2} />
                        ) : (
                          <Circle size={16} color={LightColors.textMuted} strokeWidth={2} />
                        )}
                        <Text
                          numberOfLines={1}
                          className={`text-[12px] ml-2 flex-shrink ${
                            item.done
                              ? 'font-montserrat-semi text-textPrimary'
                              : 'font-montserrat text-textSecondary'
                          }`}
                        >
                          {item.label}
                        </Text>
                        {!item.done && item.note && (
                          <Text
                            numberOfLines={1}
                            className="text-[11px] font-montserrat text-textMuted ml-1.5 flex-shrink"
                          >
                            · {item.note}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}
                <Text className="text-[10px] font-montserrat-bold text-textTertiary uppercase tracking-wider mb-1.5 text-center">
                  {ctaIsSlide
                    ? 'Slide to confirm — customer is notified instantly'
                    : 'Tap to advance — customer is notified instantly'}
                </Text>
                <StatusActionButton
                  // Remount when the status changes OR a downstream modal
                  // is dismissed so a latched SlideToConfirm re-arms.
                  key={`${booking.status}:${slideResetKey}`}
                  status={booking.status}
                  errandSlug={errandSlug}
                  isTransportation={isTransportation}
                  pinVerified={pinVerified}
                  onPress={handleStatusUpdate}
                  loading={loading}
                />
              </View>
            ) : (
              <View
                className="px-5 pt-3 pb-3 border-t border-divider bg-surface items-center"
                onLayout={(e) => setCtaH(e.nativeEvent.layout.height)}
              >
                <Text className="text-[11px] font-montserrat text-textTertiary uppercase tracking-wider mb-0.5">
                  Read-only view
                </Text>
                <Text className="text-xs font-montserrat text-textSecondary">
                  Status: {STATUS_LABELS[booking.status] ?? booking.status}
                </Text>
              </View>
            )}
          </Animated.View>
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: LightColors.surface }} />
        </KeyboardAvoidingView>
      </View>


      {/* Photo Proof Modal */}
      {showPhotoProof && (
        <PhotoProofModal
          type={showPhotoProof}
          onConfirm={handlePhotoConfirm}
          onClose={() => {
            setShowPhotoProof(null);
            // Re-arm the slide CTA — the transition was abandoned.
            setSlideResetKey((k) => k + 1);
          }}
        />
      )}

      {/* Receipt Capture (shopping errands) */}
      <ReceiptCaptureModal
        visible={showReceipt}
        budget={Number(booking.shopping_budget ?? 0)}
        submitting={submittingReceipt}
        onSubmit={async ({ actualCost, receiptUri }) => {
          // Close the sheet + advance the UI immediately. Receipt
          // upload runs in the background; on failure we revert and
          // toast (mirrors the optimistic flow used by advanceStatus).
          const prev = booking;
          const optimistic: Booking = {
            ...prev,
            status: 'picked_up' as BookingStatus,
            actual_item_cost: actualCost,
            receipt_photo_url: receiptUri,
            picked_up_at: prev.picked_up_at ?? new Date().toISOString(),
          };
          fetchedQ.mutate(optimistic);
          updateErrandStatus('picked_up');
          setShowReceipt(false);

          setSubmittingReceipt(true);
          runnerService
            .submitPickedUpWithReceipt(booking.id, { actualCost, receiptUri })
            .then(() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            })
            .catch((err: any) => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
              fetchedQ.mutate(prev);
              updateErrandStatus(prev.status as BookingStatus);
              toast.error(
                err?.message ?? err?.response?.data?.message ?? 'Failed to submit receipt',
              );
            })
            .finally(() => setSubmittingReceipt(false));
        }}
        onClose={() => setShowReceipt(false)}
      />

      {/* Completion Modal */}
      {showCompletion && (
        <CompletionModal
          bookingId={booking.id}
          deliveryPhotoUrl={deliveryPhotoUrl}
          requiresSignature={!isSingleLocation && !isTransportation}
          title={
            isTransportation
              ? 'Complete Ride'
              : isSingleLocation
              ? 'Mark Errand Done'
              : 'Complete Errand'
          }
          subtitle={
            isTransportation
              ? 'Tap confirm once the passenger has safely reached their destination.'
              : isSingleLocation
              ? 'Confirm once the task is finished on-site. The customer will be notified right away.'
              : undefined
          }
          onComplete={handleCompletionConfirm}
          onClose={() => {
            setShowCompletion(false);
            // Re-arm the slide CTA — the completion was abandoned.
            setSlideResetKey((k) => k + 1);
          }}
        />
      )}

      {/* Success moment — brief celebratory check after the completion
          submit. SuccessCheck fires its own success haptic; onDone
          dismisses the overlay (~1s, instantly under Reduce Motion). */}
      {showSuccessMoment && (
        <View
          className="absolute inset-0 items-center justify-center"
          style={{ backgroundColor: `${LightColors.ink}59`, zIndex: 60 }}
          pointerEvents="auto"
        >
          <SuccessCheck
            celebrate
            onDone={() => setShowSuccessMoment(false)}
          />
        </View>
      )}

      {/* Rate Customer Modal */}
      {showRate && (
        <RateCustomerModal
          customerName={booking.dropoff_contact_name ?? 'Customer'}
          onSubmit={handleRateSubmit}
          onSkip={handleRateSkip}
        />
      )}

      {/* Runner SOS confirm */}
      <ConfirmModal
        visible={showSOSConfirm}
        title="Trigger emergency SOS?"
        message="Your trusted contacts will get a live trip link via SMS, and ErrandGuy safety will be alerted immediately. Only use this for real emergencies."
        confirmLabel="Send SOS"
        confirmLoadingLabel="Sending…"
        cancelLabel="Not now"
        destructive
        loading={sosLoading}
        onConfirm={handleConfirmSOS}
        onCancel={() => setShowSOSConfirm(false)}
      />

      {/* Branded leave confirm for the in-app back chevron — matches the
          SOS / payout / logout ConfirmModals instead of a raw OS Alert.
          (The Android hardware-back double-press toast is unchanged.) */}
      <ConfirmModal
        visible={showLeaveConfirm}
        title="Leave active errand?"
        message="You can come back any time, but make sure you don't lose track of the customer."
        confirmLabel="Leave"
        cancelLabel="Stay"
        destructive
        onConfirm={() => {
          setShowLeaveConfirm(false);
          const go = leaveActionRef.current;
          leaveActionRef.current = null;
          go?.();
        }}
        onCancel={() => setShowLeaveConfirm(false)}
      />
    </SafeAreaView>
  );
}
