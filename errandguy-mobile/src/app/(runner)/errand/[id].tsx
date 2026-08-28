import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, Pressable, Linking, KeyboardAvoidingView, Platform, useWindowDimensions, Animated, PanResponder } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
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
  Banknote,
  ChevronRight,
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
import { UploadProgress } from '../../../components/ui/UploadProgress';
import { FloatingModal } from '../../../components/ui/FloatingModal';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { useLocationStore } from '../../../stores/locationStore';
import { useSmartPolling } from '../../../hooks/useSmartPolling';
import { useBackGuard } from '../../../hooks/useBackGuard';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { useQuery } from '../../../hooks/useQuery';
import { useEta } from '../../../hooks/useEta';
import { useEchoChannel } from '../../../hooks/useEchoChannel';
import { CacheTTL } from '../../../services/cache.service';
import { runnerService } from '../../../services/runner.service';
import { supportService } from '../../../services/support.service';
import type { Booking } from '../../../types';
import { STATUS_LABELS } from '../../../constants/statusLabels';
import { Elevation, LightColors } from '../../../constants/colors';
import { Radius } from '../../../constants/radius';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import { formatCurrency } from '../../../utils/formatCurrency';
import type { BookingStatus } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { haptics } from '../../../utils/haptics';
import { compressProofImage } from '../../../utils/proofImage';
import {
  getPreferredNavApp,
  normalizeCoords,
  openExternalNav,
  setPreferredNavApp,
  type ExternalNavApp,
} from '../../../utils/externalNav';

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

/** Straight-line arrival radius (metres). GPS-jitter-tolerant, deliberately
 *  wider than a route-distance check so the prompt surfaces as the runner
 *  pulls up rather than exactly on the pin. */
const ARRIVAL_RADIUS_M = 120;

/** Terminal statuses — no further runner action is possible. */
const TERMINAL_STATUSES = ['completed', 'cancelled', 'no_runner'];

/**
 * Monotonic rank of every status the runner can observe. Used ONLY to reject a
 * realtime broadcast that would move the cockpit BACKWARDS — a late-delivered
 * event for a transition the runner has already advanced past would otherwise
 * flicker the CTA back to the previous step. Terminal statuses bypass the
 * check entirely: a cancellation must always win, whatever it arrives after.
 */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  matched: 1,
  accepted: 2,
  heading_to_pickup: 3,
  arrived_at_pickup: 4,
  picked_up: 5,
  in_transit: 6,
  arrived_at_dropoff: 7,
  delivered: 8,
  completed: 9,
};

/**
 * Canned mid-errand issues. Each opens a real, booking-linked support ticket
 * (the same threaded system the help screen uses) so a runner stuck at the
 * curb can report in one tap instead of composing an email one-handed.
 */
const ISSUE_REASONS: { key: string; label: string; message: string }[] = [
  {
    key: 'customer_unreachable',
    label: 'Customer is unreachable',
    message:
      "I can't reach the customer for this errand — calls and chat are going unanswered.",
  },
  {
    key: 'wrong_address',
    label: 'Wrong or unreachable address',
    message:
      "The address on this errand looks wrong or I can't reach it. I need help sorting out the location.",
  },
  {
    key: 'store_closed',
    label: 'Store / biller is closed',
    message:
      'The store or biller for this errand is closed or cannot serve the request right now.',
  },
  {
    key: 'item_unavailable',
    label: 'Item is unavailable',
    message:
      "An item on this errand isn't available and I need instructions on how to proceed.",
  },
  {
    key: 'other',
    label: 'Something else',
    message:
      'I ran into a problem on this errand and need help from the ErrandGuy team.',
  },
];

/**
 * Watches the hot `currentLocation` slice in a LEAF (same P14 pattern as
 * RunnerEtaLeaf) and fires `onArrive` exactly once when the runner crosses
 * inside ARRIVAL_RADIUS_M of the active target. Re-arms only after the
 * runner drifts well back out (GPS jitter / re-route) or `enabled` cycles,
 * so a status change or a lingering fix doesn't re-prompt. Renders nothing
 * — it exists purely to keep the per-fix subscription out of the ~1100-line
 * parent. Gracefully idle when location or target is absent. (P14)
 */
function RunnerArrivalWatcher({
  targetLat,
  targetLng,
  enabled,
  onArrive,
}: {
  targetLat?: number | null;
  targetLng?: number | null;
  enabled: boolean;
  onArrive: () => void;
}) {
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const firedRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      firedRef.current = false;
      return;
    }
    if (!currentLocation || targetLat == null || targetLng == null) return;
    const tLat = Number(targetLat);
    const tLng = Number(targetLng);
    if (!Number.isFinite(tLat) || !Number.isFinite(tLng)) return;
    const dLat = (tLat - currentLocation.lat) * 111_000;
    const dLng =
      (tLng - currentLocation.lng) * 111_000 * Math.cos((currentLocation.lat * Math.PI) / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist < ARRIVAL_RADIUS_M && !firedRef.current) {
      firedRef.current = true;
      onArrive();
    } else if (dist > ARRIVAL_RADIUS_M * 2.5 && firedRef.current) {
      firedRef.current = false;
    }
  }, [currentLocation, targetLat, targetLng, enabled, onArrive]);
  return null;
}

/**
 * Subscribes to the hot `currentLocation` slice in a LEAF and computes the live
 * ETA to a (rarely-changing) target, rendering its child via a render-prop with
 * the current minutes. This keeps a per-GPS-fix re-render scoped to just the
 * step-hero subtree instead of the ~1100-line ActiveErrandScreen. (P14)
 */
function RunnerEtaLeaf({
  targetLat,
  targetLng,
  children,
}: {
  targetLat?: number | null;
  targetLng?: number | null;
  children: (minutes: number | null) => React.ReactElement | null;
}) {
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const eta = useEta(
    currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : null,
    targetLat != null && targetLng != null
      ? { lat: Number(targetLat), lng: Number(targetLng) }
      : null,
  );
  return children(eta.minutes);
}

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
  // NOTE: this screen deliberately does NOT subscribe to `currentLocation` — a
  // GPS fix writes a new object every ~6-10s and would re-render this entire
  // ~1100-line screen. The live-ETA consumers (the map badge and the step hero)
  // each subscribe to it in their own leaf instead (RunnerActiveMap + the
  // <RunnerEtaLeaf> wrapper below), so location churn stays contained. (P14)
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
  // Extra hold on the success overlay so the earnings line is actually
  // readable — SuccessCheck's own onDone fires at ~900ms, which is enough for
  // a checkmark but not for a peso figure. Cleared on unmount.
  const successHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (successHoldRef.current) clearTimeout(successHoldRef.current);
    },
    [],
  );
  // ── Proof-upload feedback ──────────────────────────────────────────────
  // `uploadPreparing` covers the on-device downscale (indeterminate — there is
  // no progress to report), `uploadProgress` the 0–1 bytes-sent fraction from
  // axios. null = nothing in flight, so the pill disappears entirely.
  const [uploadPreparing, setUploadPreparing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
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

  // Proactive arrival prompt. When the runner physically reaches the active
  // pin during a travel leg we surface a one-tap "mark arrived" confirm
  // instead of making them notice + tap the CTA. Only while THIS screen is
  // focused — the navigate screen (pushed on top) owns its own arrival
  // confirm, so gating on focus avoids a double prompt underneath it.
  const isFocused = useIsFocused();
  const [showArrivalPrompt, setShowArrivalPrompt] = useState(false);
  const handleArrivalDetected = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setShowArrivalPrompt(true);
  }, []);

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

  // Latest-booking ref for callbacks that must NOT re-subscribe on every
  // render (the realtime channel handler below). Assigned during render so
  // the handler always sees the booking the screen is currently showing.
  const bookingRef = useRef<Booking | null>(booking);
  bookingRef.current = booking;
  // Same reason for the cache writer: useQuery's `mutate` is re-created on
  // every data change, so a handler holding the first render's copy would be
  // writing through a stale closure. Ref it instead of depending on it.
  const mutateRef = useRef(fetchedQ.mutate);
  mutateRef.current = fetchedQ.mutate;

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
  // ── Realtime status channel ────────────────────────────────────────────
  // The runner is already authorized on the booking's private channel (the
  // same one the customer's tracking screen listens to), and every server-side
  // transition fires BookingStatusChanged. Without this subscription a
  // customer cancellation took up to a full 30s poll to reach the cockpit —
  // the runner kept driving, and the CTA could still fire a doomed transition.
  //
  // The handler mirrors the poll's merge semantics exactly (SWR cache + runner
  // store), with one extra guard: a late event that would move the cockpit
  // BACKWARDS is ignored, because the runner's own optimistic advance is
  // already ahead of it. Terminal statuses always win.
  const applyRealtimeStatus = useCallback((payload: unknown) => {
    const incoming = payload as Partial<Booking> | null;
    if (!incoming?.status) return;
    const cur = bookingRef.current;
    if (!cur) return;
    if (incoming.id && incoming.id !== cur.id) return;
    if (incoming.status === cur.status) return;

    const isTerminal = TERMINAL_STATUSES.includes(incoming.status);
    if (!isTerminal) {
      const incomingRank = STATUS_RANK[incoming.status];
      const currentRank = STATUS_RANK[cur.status];
      if (
        incomingRank != null &&
        currentRank != null &&
        incomingRank < currentRank
      ) {
        return;
      }
    }

    const merged = { ...cur, ...incoming } as Booking;
    void mutateRef.current(merged);

    // Same store-sync side effect the poll performs — home/location/chat
    // consumers read `currentErrand`.
    const store = useRunnerStore.getState();
    if (store.currentErrand?.id === merged.id && merged.status !== store.currentErrand.status) {
      if (merged.status === 'completed' || merged.status === 'cancelled') {
        store.updateErrandStatus(merged.status);
      } else {
        useRunnerStore.setState({ currentErrand: merged });
      }
    }

    // The one transition the runner cannot see coming: tell them out loud so
    // they stop driving instead of noticing a greyed-out CTA later.
    if (incoming.status === 'cancelled') {
      haptics.warning();
      toast.warning('This errand was cancelled. You can stop heading there.');
    }
    // Everything above reads through refs or store getState, so this callback
    // is created once and the channel is never re-subscribed. (useEchoChannel
    // ref-pins onEvent too, but keeping it stable makes that a belt AND braces.)
  }, []);

  const { isConnected: statusRealtimeConnected } = useEchoChannel({
    channel: `booking.${id ?? 'none'}`,
    event: 'booking.status',
    enabled: !!id,
    onEvent: applyRealtimeStatus,
  });

  // Status reconcile poll while the errand is non-terminal. It is now a
  // FALLBACK behind the realtime channel above, so the cadence adapts the same
  // way the customer tracking screen's does: relax to 60s while the channel is
  // genuinely subscribed, drop back to 30s the moment it isn't (socket down,
  // auth rejected, Reverb unreachable) so a cancellation still lands quickly.
  // useSmartPolling adds offline-pause + immediate reconnect/foreground tick +
  // backoff (errors propagate — no swallow-catch — so a failing reconcile
  // backs off). (P15)
  useSmartPolling(
    async () => {
      if (!id) return;
      const r = await runnerService.getErrand(id);
      const fresh = (r?.data?.data ?? null) as Booking | null;
      if (!fresh) return;
      // Mirror into the store when this is the runner's active job so the
      // home screen + other consumers see the new status. (Store-sync side
      // effect must be preserved: terminal → updateErrandStatus, non-terminal
      // → setState currentErrand — home/location/chat consumers read it.)
      const store = useRunnerStore.getState();
      if (store.currentErrand?.id === fresh.id && fresh.status !== store.currentErrand.status) {
        if (fresh.status === 'completed' || fresh.status === 'cancelled') {
          store.updateErrandStatus(fresh.status);
        } else {
          useRunnerStore.setState({ currentErrand: fresh });
        }
      }
    },
    {
      interval: statusRealtimeConnected ? 60_000 : 30_000,
      enabled: _pollEnabled,
      runOnMount: false,
    },
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
  // ETA target (pickup vs dropoff) changes only per status phase, not per GPS
  // fix, so it stays in the parent; the moving-origin ETA itself is computed
  // inside the leaves that subscribe to currentLocation. (P14)
  const etaTargetLat = inPickupPhase ? booking?.pickup_lat : booking?.dropoff_lat;
  const etaTargetLng = inPickupPhase ? booking?.pickup_lng : booking?.dropoff_lng;

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

  // ── External navigation handoff (Waze / system maps) ───────────────────
  // Waze is what most PH riders actually drive with, so the "Maps" button now
  // offers both and remembers the choice — after the first pick it's a single
  // tap straight into the runner's own app (long-press re-opens the chooser).
  const [showNavPicker, setShowNavPicker] = useState(false);
  const [preferredNavApp, setPreferredNavAppState] =
    useState<ExternalNavApp | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPreferredNavApp()
      .then((app) => {
        if (!cancelled) setPreferredNavAppState(app);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Active destination for an external handoff. Follows the same phase rule
  // the in-app map and ETA use, so all three always point at the same pin.
  const navTarget = useMemo(
    () =>
      normalizeCoords(
        inPickupPhase ? booking?.pickup_lat : booking?.dropoff_lat,
        inPickupPhase ? booking?.pickup_lng : booking?.dropoff_lng,
      ),
    [inPickupPhase, booking?.pickup_lat, booking?.pickup_lng, booking?.dropoff_lat, booking?.dropoff_lng],
  );

  const launchExternalNav = useCallback(
    async (app: ExternalNavApp, remember: boolean) => {
      if (!navTarget) {
        toast.error('Address coordinates are missing');
        return;
      }
      if (remember) {
        setPreferredNavAppState(app);
        void setPreferredNavApp(app);
      }
      const opened = await openExternalNav(app, navTarget.lat, navTarget.lng);
      if (!opened) {
        toast.error(
          app === 'waze' ? 'Could not open Waze' : 'Could not open maps',
        );
      }
    },
    [navTarget],
  );

  const handleExternalNavPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!navTarget) {
      toast.error('Address coordinates are missing');
      return;
    }
    if (preferredNavApp) {
      void launchExternalNav(preferredNavApp, false);
      return;
    }
    setShowNavPicker(true);
  }, [navTarget, preferredNavApp, launchExternalNav]);

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

  // ── Mid-errand issue reporting ─────────────────────────────────────────
  // Replaces a `mailto:` that dropped the runner into the OS mail composer
  // with the threaded, booking-linked support ticket the app already ships.
  // One tap per canned reason: nothing to type one-handed at the curb, and
  // support sees the booking the ticket belongs to.
  const [showIssueSheet, setShowIssueSheet] = useState(false);
  const [issueSubmitting, setIssueSubmitting] = useState<string | null>(null);

  const handleReportIssue = useCallback(
    async (reason: (typeof ISSUE_REASONS)[number]) => {
      const cur = bookingRef.current;
      if (!cur || issueSubmitting) return;
      setIssueSubmitting(reason.key);
      const ref = cur.booking_number ?? cur.id;
      try {
        const r = await supportService.createTicket({
          subject: `${reason.label} — ${ref}`,
          category: 'booking',
          message: `${reason.message}\n\nErrand: ${ref}`,
          booking_id: cur.id,
        });
        const ticket = r.data?.data;
        haptics.success();
        setShowIssueSheet(false);
        // Toast first so the runner knows the report landed even if they never
        // look at the thread (or navigation is interrupted).
        toast.success('Support has your report');
        if (ticket?.id) {
          // Support tickets live in the shared (customer) stack — the runner
          // help screen already routes there and the customer layout lets
          // runners through for `support/*` specifically, so the cross-group
          // push is a proven path. Back returns to the cockpit.
          router.push(`/(customer)/support/${ticket.id}`);
        }
      } catch (err: any) {
        haptics.error();
        toast.error(errorMessage(err, copy.support.createFailed));
      } finally {
        setIssueSubmitting(null);
      }
    },
    [issueSubmitting, router],
  );

  // Re-entrancy latch for the TAP-driven status advance only. advanceStatus
  // is optimistic + fire-and-forget with no loading state, and the CTA isn't a
  // latching SlideToConfirm for the tap transitions, so a rapid double-tap
  // fired two non-idempotent, customer-notifying advances (skip-advancing the
  // booking). Cleared in advanceStatus's .then/.catch. NOT set by the
  // modal-driven callers, so the delivered→completed chain is never blocked.
  const advancingRef = useRef(false);

  const handleStatusUpdate = async () => {
    if (!booking) return;

    // A booking still in `matched` has been OFFERED to this runner but not yet
    // claimed. Tapping a "New errand offer" push lands straight here, skipping
    // the offer modal that normally calls accept — so the CTA used to fire
    // updateStatus('heading_to_pickup') against a server whose status ladder
    // starts at 'accepted', and every single tap came back 422 "Invalid status
    // transition" with no way forward. Claim the errand first; the ladder then
    // proceeds exactly as it does for a modal-accepted job.
    if (booking.status === 'matched') {
      if (advancingRef.current) return;
      advancingRef.current = true;
      setLoading(true);
      try {
        await runnerService.acceptErrand(booking.id);
        await fetchedQ.revalidate();
        haptics.success();
      } catch (e) {
        // The offer modal's own accept may already have landed, leaving this
        // screen a beat behind on a stale 'matched'. Re-read the row and only
        // complain if the errand really is still unclaimed — otherwise the
        // runner gets an error toast for a job they successfully took.
        const fresh = await runnerService
          .getErrand(booking.id)
          .then((r) => (r.data?.data ?? null) as Booking | null)
          .catch(() => null);

        if (fresh) fetchedQ.mutate(fresh);

        if (!fresh || fresh.status === 'matched' || fresh.status === 'pending') {
          toast.error(errorMessage(e, 'We couldn’t claim this errand. Please try again.'));
        }
      } finally {
        advancingRef.current = false;
        setLoading(false);
      }
      return;
    }

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

    // Guard placed AFTER the modal early-returns so those branches never touch
    // the latch (a missed clear there would stick-lock the CTA).
    if (advancingRef.current) return;
    advancingRef.current = true;
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
  // Resolves to `true` once the server confirms the transition, `false` if it
  // failed (in which case the optimistic state is reverted and a toast shown
  // here — callers never see a rejection). Sequencing steps (e.g. only open the
  // completion sheet after `delivered` is confirmed) can await this boolean.
  const advanceStatus = async (
    status: string,
    opts?: {
      pickupPhoto?: string | null;
      deliveryPhoto?: string | null;
      signature?: string | null;
      /** Surface a determinate "Uploading proof… NN%" pill over the CTA. */
      showUploadProgress?: boolean;
    },
  ): Promise<boolean> => {
    // Read the CURRENT booking (not the render-time closure) so a call made
    // after an awaited earlier advance still reverts to the right state.
    const prev = bookingRef.current;
    if (!prev) return false;
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

    // Stamp proof transitions with where + when they happened. Read the
    // GPS fix IMPERATIVELY from the store (getState) rather than
    // subscribing — this screen deliberately avoids a currentLocation
    // subscription so a per-fix write doesn't re-render the whole
    // ~1100-line cockpit (P14). Graceful: if there's no fix yet the
    // coords stay null and the upload proceeds without them; the
    // client capture timestamp always rides along.
    const fix = useLocationStore.getState().currentLocation;
    const { showUploadProgress, ...fileOpts } = opts ?? {};
    // Honest upload feedback. The proof upload is deliberately awaited before
    // the next sheet opens (money-safe: the photo must be on the server before
    // we call the handover done), which used to read as dead air on LTE — the
    // modal closed and nothing moved for 10-30s. onUploadProgress was already
    // plumbed through runnerService and simply had no caller.
    if (showUploadProgress) setUploadProgress(0);
    const proofOpts = {
      ...fileOpts,
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      capturedAt: nowIso,
      onProgress: showUploadProgress
        ? (frac: number) => setUploadProgress(frac)
        : undefined,
    };

    return runnerService
      .advanceErrandStatus(prev.id, status, proofOpts)
      .then(() => {
        if (showUploadProgress) setUploadProgress(null);
        advancingRef.current = false; // re-arm the tap guard for the next step
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
        return true;
      })
      .catch((err: any) => {
        if (showUploadProgress) setUploadProgress(null);
        advancingRef.current = false; // re-arm on failure so the runner can retry
        // Revert optimistic state and surface the error.
        haptics.error();
        if (status === 'completed') setShowSuccessMoment(false);
        setSlideResetKey((k) => k + 1);
        fetchedQ.mutate(prev);
        updateErrandStatus(prev.status as BookingStatus);
        toast.error(errorMessage(err, copy.runner.statusUpdateFailed));
        return false;
      });
  };

  const handlePhotoConfirm = async (rawUri: string) => {
    const phase = showPhotoProof;
    setShowPhotoProof(null);
    // Shrink the camera's native frame (often ~4000px / several MB) to a
    // 1600px proof shot before it goes up the wire — the same photo, a
    // fraction of the LTE wait. Falls back to the original on any failure.
    setUploadPreparing(true);
    const uri = (await compressProofImage(rawUri)) ?? rawUri;
    setUploadPreparing(false);
    if (phase === 'delivery') {
      // Flow: mark `delivered` (uploads delivery_photo) → open the
      // completion sheet so the runner can capture the signature and
      // advance to `completed`. The two transitions used to be merged
      // into a single `completed` call which dropped the delivery
      // photo on the floor; the picked_up case suffered the same
      // bug (status sent without the captured photo → 422).
      setDeliveryPhotoUrl(uri);
      // Wait for the server to CONFIRM `delivered` (with its photo upload)
      // before opening the signature/completion sheet. Otherwise a failed
      // upload on flaky LTE reverted the status yet still advanced to the
      // sheet, leading to a second failure on `completed`, a lost delivery
      // photo, and an errand stuck at arrived_at_dropoff. On failure
      // advanceStatus has already reverted + toasted; the runner stays put
      // and can retry with a fresh photo.
      const delivered = await advanceStatus('delivered', {
        deliveryPhoto: uri,
        showUploadProgress: true,
      });
      if (delivered) setShowCompletion(true);
      return;
    }
    // Pickup phase: pass the captured photo through to the backend.
    await advanceStatus('picked_up', {
      pickupPhoto: uri,
      showUploadProgress: true,
    });
  };

  const handleCompletionConfirm = async (signatureUri: string) => {
    setShowCompletion(false);
    // Only forward signature when it looks like a real file URI; the
    // CompletionModal currently emits 'signature_placeholder' which
    // would 422 on the backend's `image` rule. Pre-existing limitation
    // — leaves transport/single-location flows working untouched.
    const sig = signatureUri && signatureUri.startsWith('file') ? signatureUri : null;
    // Celebrate ONLY once the server confirms completion. SuccessCheck fires a
    // success haptic and auto-dismisses on its own ~1s timer, so showing it
    // before the (multipart signature) upload resolved made a failed/slow
    // completion feel done — the runner pocketed the phone while the errand was
    // still stuck at 'delivered'. advanceStatus reverts + toasts on failure and
    // fires setShowRate(true) on success, so the rate sheet still follows.
    const ok = await advanceStatus('completed', {
      signature: sig,
      // Only a signature makes this a multipart upload; without one there are
      // no bytes to report and the pill would flash for nothing.
      showUploadProgress: !!sig,
    });
    if (ok) setShowSuccessMoment(true);
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

      // Verifying the PIN and starting the ride are ONE real-world moment —
      // the passenger is already in the vehicle. Splitting them made the
      // runner hunt for a newly-enabled CTA behind the keyboard-expanded
      // sheet. The transport picked_up transition carries no proof gate (no
      // photo, no receipt), so nothing is skipped by chaining it here; it goes
      // through the SAME optimistic advance the CTA uses, which reverts and
      // toasts on failure — leaving the runner exactly where they'd be today,
      // verified with the CTA armed as the fallback.
      const cur = bookingRef.current;
      const next = cur ? getNextStatus(cur.status, errandSlug) : null;
      const canChain =
        !!cur &&
        cur.status === 'arrived_at_pickup' &&
        next === 'picked_up' &&
        !advancingRef.current;

      if (canChain) {
        toast.success('PIN verified — starting the ride');
        advancingRef.current = true;
        await advanceStatus('picked_up');
      } else {
        toast.success('PIN verified — ride may begin');
      }
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
      // shift continues. A 422 here is the intentional "already reviewed"
      // no-op and stays silent; everything else (including offline/timeout,
      // which carries NO err.response) surfaces a toast so the review isn't
      // lost without the runner ever knowing.
      if (err?.response?.status !== 422) {
        toast.error(
          errorMessage(err, "Couldn't submit your review. Please try again."),
        );
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

  // The runner reached the pin while their status still says they haven't
  // left. Drives the arrival prompt's copy (see the ConfirmModal below).
  const isPreDepartureStatus =
    booking.status === 'accepted' || booking.status === 'picked_up';

  // ── Runner-facing settlement metadata (DISPLAY ONLY) ───────────────────
  // `amount_to_collect` / `payment_method_type` are runner-gated fields on
  // BookingResource. Read through a tolerant cast rather than widening the
  // shared Booking type here: a booking served from an older SWR cache entry
  // (or an endpoint that hasn't been re-fetched yet) simply won't carry them,
  // and the strip must degrade to "not shown" rather than render a wrong
  // number. NOTHING about settlement changes — this is a read-out of what the
  // server already decided.
  const runnerOps = booking as Booking & {
    amount_to_collect?: number | string | null;
    payment_method_type?: string | null;
  };
  const amountToCollect: number | null = (() => {
    const raw = runnerOps.amount_to_collect;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const paymentMethodType = runnerOps.payment_method_type ?? null;
  const isCashJob = paymentMethodType === 'cash';
  // The server's `amount_to_collect` is fare-due + fronted-item-cost. Split it
  // back out for the strip's subline so the copy never calls a reimbursement a
  // "platform fee". Both parts come from fields already on the payload; the
  // TOTAL shown is always the server's figure, never a client sum.
  const itemsFronted: number = (() => {
    const n = Number(booking.actual_item_cost ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  const cashFareDue: number =
    amountToCollect != null
      ? Math.max(0, Math.round((amountToCollect - itemsFronted) * 100) / 100)
      : 0;

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
            bottomOffset={mapControlsOffset}
          />
        </View>

        {/* Arrival detector — fires the "mark arrived" prompt once the
            runner reaches the active pin on a travel leg. Renders null;
            it only subscribes to the hot GPS slice in its own leaf.

            Armed across the WHOLE travel window, including the two
            pre-departure statuses (`accepted`, `picked_up`): a runner who just
            starts driving without tapping "Head to pickup" / "Start delivery"
            used to arrive with the assist completely disarmed — stale status
            for the customer, and two blind CTA taps at the curb. The prompt
            adapts its copy in that case (it advances the travel leg, never
            skipping a step — the backend rejects any skip).

            Excluded at `picked_up` for single-location errands: there is no
            second leg there, the runner is already on site, and the next step
            is COMPLETION — which must never be geofence-prompted.

            `key` on the status remounts the watcher on every transition so its
            once-only latch re-arms per leg. Previously `enabled` cycled
            false→true between legs and did that implicitly; now that the
            pre-departure statuses are also enabled, the flag stays true across
            accepted→heading_to_pickup and the explicit remount is what lets
            the arrival prompt follow the departure one. */}
        <RunnerArrivalWatcher
          key={booking.status}
          targetLat={etaTargetLat}
          targetLng={etaTargetLng}
          enabled={
            isFocused &&
            !isReadOnly &&
            isErrandActive &&
            (booking.status === 'heading_to_pickup' ||
              booking.status === 'in_transit' ||
              booking.status === 'accepted' ||
              (booking.status === 'picked_up' && !isSingleLocation))
          }
          onArrive={handleArrivalDetected}
        />

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
                <RunnerEtaLeaf targetLat={etaTargetLat} targetLng={etaTargetLng}>
                  {(etaMin) => (
                    <CurrentStepHero
                      eyebrow={inPickupPhase ? 'PICKUP' : 'DROP-OFF'}
                      title={runnerHeroTitle}
                      subtitle={(inPickupPhase
                        ? booking.pickup_address ?? errandRule.pickupLabel
                        : booking.dropoff_address ?? errandRule.dropoffLabel) ?? undefined}
                      etaMinutes={etaMin != null ? Math.max(1, Math.round(etaMin)) : null}
                      accent={booking.status === 'cancelled' ? 'danger' : 'brand'}
                    />
                  )}
                </RunnerEtaLeaf>
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
                      onPress={handleExternalNavPress}
                      onLongPress={() => {
                        // Long-press always re-opens the chooser, so a
                        // remembered preference is never a one-way door.
                        Haptics.selectionAsync().catch(() => {});
                        setShowNavPicker(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Open in another navigation app"
                      accessibilityHint="Long press to choose between Waze and Maps"
                      className="h-11 px-4 rounded-xl border border-dividerStrong bg-surfaceMuted flex-row items-center justify-center"
                    >
                      <MapPin size={15} color={LightColors.textPrimary} strokeWidth={1.8} />
                      <Text className="text-textPrimary text-[13px] font-montserrat-semi ml-1.5">
                        Maps
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* ── Cash-collection strip ─────────────────────────────
                    The single fact a runner cannot afford to learn at the
                    door. Sits in the ALWAYS-VISIBLE header block (not the
                    scrollable details) because the collapsed sheet is sized
                    from this block — so it can never be scrolled out of
                    sight on a job where money changes hands in person.
                    Display-only; the figure is the server's. */}
                {amountToCollect != null && isErrandActive && (
                  <View
                    // Brand gold (`accent` family = money/earnings, never a
                    // status) at the SOFT chip rung, not the faint tint: on a
                    // transport ride the amber-washed PIN card sits just below
                    // in the scroll region, and a paler wash would blur into it.
                    className="mt-3 flex-row items-center rounded-xl px-3 py-2.5 bg-accentSoft border border-accentStrong"
                    accessible
                    accessibilityLabel={`Collect ${formatCurrency(
                      amountToCollect,
                    )} in cash from the customer`}
                  >
                    <Banknote size={17} color={LightColors.accentDark} strokeWidth={2} />
                    <View className="flex-1 ml-2.5">
                      <Text className="text-[13px] font-montserrat-bold text-textPrimary">
                        Collect {formatCurrency(amountToCollect)} in cash
                      </Text>
                      <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                        {!isCashJob
                          ? `Reimbursement for the ${formatCurrency(
                              itemsFronted,
                            )} you fronted — the fare is already paid online`
                          : itemsFronted > 0
                          ? `${formatCurrency(
                              cashFareDue,
                            )} fare + ${formatCurrency(
                              itemsFronted,
                            )} you fronted · the platform fee is deducted from your balance`
                          : booking.runner_payout != null
                          ? `Cash fare · you keep ${formatCurrency(
                              booking.runner_payout,
                            )}, the platform fee is deducted from your balance`
                          : 'Cash fare · collect it from the customer'}
                      </Text>
                    </View>
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
                  // Neutral chip; the enabled/disabled state is carried by the
                  // glyph colour (blue Phone when callable, muted when not) —
                  // the chip background no longer differentiates.
                  className="w-10 h-10 rounded-full items-center justify-center mr-2 bg-surfaceMuted"
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
                  className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center"
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

                  {(booking.stops?.length ?? 0) > 0 && (
                    <View className="mb-3">
                      <Text className="text-[10px] font-montserrat-bold text-textTertiary mb-2 uppercase" style={{ letterSpacing: 1.2 }}>
                        Extra stops
                      </Text>
                      {(booking.stops ?? []).map((stop) => (
                        <View
                          key={stop.id}
                          className="flex-row items-start bg-surfaceMuted rounded-xl px-3 py-2.5 mb-2"
                        >
                          <View
                            className="w-6 h-6 rounded-full items-center justify-center mr-2.5"
                            style={{ backgroundColor: LightColors.primaryLight }}
                          >
                            <Text className="text-[11px] font-inter-semi text-primary">
                              {stop.sequence}
                            </Text>
                          </View>
                          <View className="flex-1">
                            <Text
                              className="text-[13px] font-montserrat-semi text-textPrimary"
                              numberOfLines={2}
                            >
                              {stop.address}
                            </Text>
                            {stop.contact_name || stop.contact_phone ? (
                              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                                {[stop.contact_name, stop.contact_phone].filter(Boolean).join(' · ')}
                              </Text>
                            ) : null}
                            {stop.note ? (
                              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                                “{stop.note}”
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

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

                  {/* Opens the in-app, booking-linked support thread instead
                      of the OS mail composer — see the issue sheet below. */}
                  <Pressable
                    onPress={() => {
                      haptics.light();
                      setShowIssueSheet(true);
                    }}
                    accessibilityRole="button"
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
                Reverb realtime, and is mirrored on the customer
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
                {/* Honest proof-upload feedback. The handover deliberately
                    waits for the server to confirm the photo before the next
                    sheet opens (money-safe), which used to read as dead air on
                    LTE — the capture modal closed and nothing moved for 10-30s.
                    Two phases: the on-device downscale (indeterminate) and the
                    real bytes-sent fraction. */}
                {(uploadPreparing || uploadProgress !== null) && (
                  <UploadProgress
                    progress={uploadPreparing ? null : uploadProgress}
                    label={uploadPreparing ? 'Preparing photo' : 'Uploading proof'}
                    style={{ marginBottom: 10 }}
                  />
                )}
                <Text className="text-[10px] font-montserrat-bold text-textTertiary uppercase tracking-wider mb-1.5 text-center">
                  {booking.status === 'matched'
                    ? 'This errand is offered to you — tap to claim it'
                    : ctaIsSlide
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
          // Downscale before the wire, not before the optimistic flip: the
          // runner is already moving on and the local preview uses the
          // original file. A receipt at 1600px stays legible for disputes
          // while costing a fraction of the LTE upload.
          compressProofImage(receiptUri)
            .then((compressed) =>
              runnerService.submitPickedUpWithReceipt(booking.id, {
                actualCost,
                receiptUri: compressed ?? receiptUri,
              }),
            )
            .then(() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            })
            .catch((err: any) => {
              haptics.error();
              fetchedQ.mutate(prev);
              updateErrandStatus(prev.status as BookingStatus);
              toast.error(errorMessage(err, copy.runner.receiptSubmitFailed));
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
          submit, now naming the one number the runner actually cares about.
          SuccessCheck fires its own success haptic; onDone starts a short
          extra hold so the figure is readable (skipped under Reduce Motion).

          The amount is NOT computed here — `runner_payout` is the server's own
          figure, already in the SWR cache; when it's absent we simply show the
          checkmark as before rather than invent a number. The subline never
          claims a wallet credit on a cash job (there the runner keeps the cash
          and the platform fee is debited instead). */}
      {showSuccessMoment && (
        <View
          className="absolute inset-0 items-center justify-center px-10"
          style={{ backgroundColor: `${LightColors.ink}59`, zIndex: 60 }}
          pointerEvents="auto"
        >
          <SuccessCheck
            celebrate
            onDone={() => {
              if (reduceMotion) {
                setShowSuccessMoment(false);
                return;
              }
              if (successHoldRef.current) clearTimeout(successHoldRef.current);
              successHoldRef.current = setTimeout(
                () => setShowSuccessMoment(false),
                1600,
              );
            }}
          />
          {booking.runner_payout != null && (
            <View className="items-center mt-5">
              <Text className="text-[13px] font-montserrat-semi text-white/80">
                You earned
              </Text>
              <Text className="text-[30px] font-inter-semi tabular-nums text-white mt-0.5">
                {formatCurrency(booking.runner_payout)}
              </Text>
              <Text className="text-[12px] font-montserrat text-white/75 mt-1.5 text-center leading-[17px]">
                {isCashJob
                  ? 'You keep the cash you collected — the platform fee comes out of your balance.'
                  : 'It lands in your balance once the payment settles.'}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Rate Customer Modal. Held back while the success overlay is up: a
          real RN Modal renders in its own window ABOVE the in-tree overlay, so
          without this gate the earnings moment would be covered the instant it
          appeared. */}
      {showRate && !showSuccessMoment && (
        <RateCustomerModal
          customerName={booking.dropoff_contact_name ?? 'Customer'}
          onSubmit={handleRateSubmit}
          onSkip={handleRateSkip}
        />
      )}

      {/* Proactive arrival confirm — advances ONE step via the normal gated
          handler (arrival steps are gate-free; the photo/PIN capture lives on
          the NEXT step). Nothing is ever advanced without this tap.

          When the runner never announced the travel leg the copy says so
          plainly: this tap updates the leg, and the watcher (remounted on the
          status change) surfaces the real arrival confirm straight after. We
          deliberately do NOT chain the two transitions behind one tap. */}
      <ConfirmModal
        visible={showArrivalPrompt}
        title={
          isPreDepartureStatus
            ? `You're at the ${inPickupPhase ? 'pickup' : 'drop-off'}`
            : "You've arrived — mark arrived?"
        }
        message={
          isPreDepartureStatus
            ? `Your status still says “${
                STATUS_LABELS[booking.status] ?? booking.status
              }”, so the customer can't see you moving. Update it now — we'll ask you to confirm arrival right after.`
            : `Looks like you've reached the ${
                inPickupPhase ? 'pickup' : 'drop-off'
              }. Let the customer know — you can capture any required photo or PIN on the next step.`
        }
        confirmLabel={isPreDepartureStatus ? 'Update status' : 'Mark arrived'}
        cancelLabel="Not yet"
        onConfirm={() => {
          setShowArrivalPrompt(false);
          void handleStatusUpdate();
        }}
        onCancel={() => setShowArrivalPrompt(false)}
      />

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

      {/* ── External navigation chooser ─────────────────────────────────
          Shown the first time the runner taps "Maps" (and on any long-press
          afterwards). The pick is remembered, so every later tap goes straight
          into their own app. Waze is listed first: it is what most PH riders
          actually drive with. */}
      <FloatingModal
        isVisible={showNavPicker}
        onClose={() => setShowNavPicker(false)}
        title="Navigate with"
      >
        {(
          [
            {
              app: 'waze' as ExternalNavApp,
              label: 'Waze',
              hint: 'Live traffic + hazard reports',
            },
            {
              app: 'maps' as ExternalNavApp,
              label: Platform.OS === 'ios' ? 'Apple Maps' : 'Google Maps',
              hint: 'Your phone’s built-in maps',
            },
          ]
        ).map((opt) => (
          <Pressable
            key={opt.app}
            onPress={() => {
              haptics.selection();
              setShowNavPicker(false);
              void launchExternalNav(opt.app, true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Navigate with ${opt.label}`}
            className="flex-row items-center rounded-xl border border-divider bg-surfaceMuted px-4 py-3 mb-2.5"
          >
            <Navigation size={17} color={LightColors.primary} strokeWidth={2} />
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-bold text-textPrimary">
                {opt.label}
              </Text>
              <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                {opt.hint}
              </Text>
            </View>
            <ChevronRight size={16} color={LightColors.textTertiary} />
          </Pressable>
        ))}
        <Text className="text-[11px] font-montserrat text-textTertiary mt-1 leading-[15px]">
          We’ll remember your choice. Live tracking pauses while you’re outside
          ErrandGuy — come back here to update your status.
        </Text>
      </FloatingModal>

      {/* ── Mid-errand issue sheet ──────────────────────────────────────
          One tap per canned reason opens a real, booking-linked support
          thread and drops the runner straight into it. Replaces the old
          `mailto:` hand-off. */}
      <FloatingModal
        isVisible={showIssueSheet}
        onClose={() => {
          if (issueSubmitting) return;
          setShowIssueSheet(false);
        }}
        title="What went wrong?"
      >
        {ISSUE_REASONS.map((reason) => {
          const busy = issueSubmitting === reason.key;
          return (
            <Pressable
              key={reason.key}
              onPress={() => void handleReportIssue(reason)}
              disabled={!!issueSubmitting}
              accessibilityRole="button"
              accessibilityLabel={reason.label}
              accessibilityState={{ disabled: !!issueSubmitting, busy }}
              className={`flex-row items-center rounded-xl border border-divider bg-surfaceMuted px-4 py-3 mb-2.5 ${
                issueSubmitting && !busy ? 'opacity-50' : ''
              }`}
            >
              <Text className="flex-1 text-[13px] font-montserrat-semi text-textPrimary">
                {reason.label}
              </Text>
              {busy ? (
                <Text className="text-[11px] font-montserrat text-textTertiary">
                  Sending…
                </Text>
              ) : (
                <ChevronRight size={16} color={LightColors.textTertiary} />
              )}
            </Pressable>
          );
        })}
        <Text className="text-[11px] font-montserrat text-textTertiary mt-1 leading-[15px]">
          Opens a support thread linked to{' '}
          {booking.booking_number ?? 'this errand'} — you can add details there.
        </Text>
      </FloatingModal>
    </SafeAreaView>
  );
}
