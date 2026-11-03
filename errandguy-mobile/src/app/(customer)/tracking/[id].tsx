import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
  Linking,
  Animated,
  Easing,
  Share,
  Modal,
  useWindowDimensions,
  AccessibilityInfo,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Banknote,
  MessageCircle,
  Phone,
  Share2,
  Shield,
  Bike,
  Check,
  ChevronDown,
  ChevronUp,
  Crosshair,
  MapPin,
  SearchX,
  Flag,
  UserX,
  X,
} from 'lucide-react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing as REasing,
  Keyframe,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { HereMapView, HereMarker, HerePolyline, type HereMapViewRef } from '../../../components/map';
import { useBookingStore } from '../../../stores/bookingStore';
import { useChatStore } from '../../../stores/chatStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useLocationStore } from '../../../stores/locationStore';
import { bookingService } from '../../../services/booking.service';
// The panic button is durable now: the raise is persisted and retried by
// sosIntent until the server ACKs, so this screen only presents that state.
import {
  acknowledgeSosRejection,
  describeSosFailure,
  raiseSos,
  resumeSosIntent,
  retryNow as retrySosNow,
  standDownSos,
  useSosIntentStore,
} from '../../../services/sosIntent';
import {
  clearSosActive,
  hydrateSosActive,
  reconcileSosActive,
  useSosActive,
} from '../../../services/sosActive';
import {
  SosPendingSheet,
  type SosCallableContact,
} from '../../../components/safety/SosPendingSheet';
import {
  SosActiveCard,
  SosResolvedNotice,
  sosAlertedText,
} from '../../../components/safety/SosActiveCard';
import { ReportUserSheet } from '../../../components/safety/ReportUserSheet';
import { useRunnerTracking } from '../../../hooks/useRunnerTracking';
import { useBookingStatus } from '../../../hooks/useBookingStatus';
import { useSmartPolling } from '../../../hooks/useSmartPolling';
import { useBackGuard } from '../../../hooks/useBackGuard';
import { useKeepAwakeWhile } from '../../../hooks/useKeepAwakeWhile';
import { useEta } from '../../../hooks/useEta';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { useCompleteBookingPayment } from '../../../hooks/useCompleteBookingPayment';
import { TrackingSkeleton } from '../../../components/ui/Skeleton';
import { Avatar } from '../../../components/ui/Avatar';
import { RatingStars } from '../../../components/ui/RatingStars';
import { StatusTimeline } from '../../../components/ui/StatusTimeline';
import { JourneyBeads } from '../../../components/ui/JourneyBeads';
import { Button } from '../../../components/ui/Button';
import { Illustration } from '../../../components/ui/Illustration';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { ExpandableSheet } from '../../../components/ui/ExpandableSheet';
import { PaymentProgress } from '../../../components/ui/PaymentProgress';
import { formatTime } from '../../../utils/formatDate';
import { formatCurrency } from '../../../utils/formatCurrency';
import { mediaSource } from '../../../utils/mediaSource';
import { ImageLightbox } from '../../../components/ui/ImageLightbox';
import { ShoppingProgressCard } from '../../../components/customer/ShoppingProgressCard';
import { StopsProgressCard } from '../../../components/customer/StopsProgressCard';
// The receipt and the Activity detail sheet must tell the SAME money story,
// so both read the outcome through one helper (it normalises the server's
// decimal-as-string casts; it computes no money of its own).
import { bookingMoneyOutcome } from '../../../components/customer/BookingDetailSheet';
import {
  BOOKING_STOPS_UPDATED,
  stopCompletionsFromNotification,
  mergeStopCompletions,
} from '../../../utils/stopProgress';
import { latestProgressCard, progressCardSignature } from '../../../utils/liveProgressCards';
import { resolveImageUrl } from '../../../utils/resolveImageUrl';
import { errorMessage } from '../../../utils/errorCatalog';
import { haptics } from '../../../utils/haptics';
import { AWAITING_PAYMENT_LABEL, STATUS_LABELS } from '../../../constants/statusLabels';
import {
  isAwaitingPayment,
  paymentDeadlineLine,
  UNPAID_CANCEL_TITLE,
  unpaidCancelMessage,
  wasCancelledForUnpaidPayment,
} from '../../../utils/bookingPayment';
import { itemsCashDue, itemsCashReadyLine } from '../../../utils/shoppingMoney';
import { cancelMoneyLines, cancelReceiptMessage, type CancelPreview } from '../../../utils/cancelPreview';
import { rebookDraft } from '../../../utils/rebookDraft';
import { farePaymentLine } from '../../../utils/farePaymentLine';
import { dialNumber, EMERGENCY_NUMBER } from '../../../components/safety/emergency';
import { refundedToWallet } from '../../../utils/noRunner';
import { scheduledWindowLabel, SCHEDULED_MATCH_LEAD_MINUTES } from '../../../utils/scheduledBooking';
import { formatRating } from '../../../utils/rating';
import { isRunnerVerified, runnerVehicleLine } from '../../../utils/runnerVehicle';
import { LightColors, Elevation } from '../../../constants/colors';
import { copy } from '../../../constants/copy';

import { SHOPPING_ITEMS_UPDATED, shoppingItemsFromNotification } from '../../../utils/shoppingChecklist';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import type { Booking, BookingStatus, BookingStatusLog } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { routeService } from '../../../services/route.service';
import { prefetchChatMessages } from '../../../services/preload.service';


const CAN_CANCEL_STATUSES: BookingStatus[] = [
  'pending', 'matched', 'accepted', 'heading_to_pickup',
];

/**
 * The cancel confirm's body when the fee preview couldn't be fetched. The
 * server only keeps a fee once a runner has accepted a paid errand, so that is
 * the honest "maybe" — never a promise either way. (Same words on the waiting
 * screen's cancel.)
 */
const CANCEL_PREVIEW_FAILED =
  'We couldn’t check for a cancellation fee just now. If a runner has already accepted your errand, a small fee may apply. This can’t be undone.';

/**
 * Has the customer already rated this errand?
 *
 * BookingResource ships `review` / `customer_review` (BookingController::show
 * eager-loads `reviews`); the shared Booking type predates both. A realtime
 * lifecycle payload carries neither, which reads as "not rated yet" — exactly
 * the right default for an errand that just completed.
 */
type WithReview = { review?: unknown; customer_review?: unknown };
const bookingReview = (b: Booking | null | undefined): unknown => {
  const r = b as (Booking & WithReview) | null | undefined;
  return r?.review ?? r?.customer_review ?? null;
};

// Auto-map window. Exported so ops can tune when tiles auto-mount without a
// redesign — HERE raster tiles are billed per request, so this list IS the
// screen's cost bound.
export const MAP_PHASES: BookingStatus[] = ['pending', 'matched', 'accepted', 'heading_to_pickup', 'picked_up', 'in_transit'];
// Once the map auto-mounted, hold it through the arrived_* pauses so the
// arrive→pickup boundary never unmounts/remounts the tiles (see mapLatchRef).
const HOLD_PHASES: BookingStatus[] = ['arrived_at_pickup', 'arrived_at_dropoff'];
// VISUAL grouping only — the receipt canvas/sheet layout. Do NOT reuse for
// the Android back guard: isLiveBooking below keeps its own expression where
// 'delivered' still counts as live.
const TERMINAL_UI: BookingStatus[] = ['delivered', 'completed', 'cancelled', 'no_runner'];

// Statuses where the runner is realistically ticking the shopping list off.
// Everything the runner reports at the till (actual_item_cost, receipt) lands
// on the picked_up TRANSITION, which the realtime watcher already refetches —
// so the tick fallback below only needs to cover the window before it.
const SHOPPING_TICK_STATUSES: BookingStatus[] = ['accepted', 'heading_to_pickup', 'arrived_at_pickup'];

// Constant across statuses — a changing snapPoints identity re-fires the
// sheet's initial-position effect and stomps the user's chosen snap. Only
// `initial` may flip (once, into a terminal status).
const SNAP_POINTS = { peek: 0.24, half: 0.52, full: 0.92 } as const;

// Radar visuals sit on the brand-blue gradient — same doctrine as
// book/confirm: white only, a primary stroke would vanish into the backdrop.
const RING_COLOR = '#FFFFFF';

/* ─── Radar pulse (gradient canvas) ───
   Same recipe as book/confirm's searching radar so pre-dispatch reads as one
   continuous moment across screens. Two rings, not three — this screen also
   runs the beads + live-dot loops and the budget is ≤2 loops per mode. */
function PulseRing({ delay, size }: { delay: number; size: number }) {
  const scale = useSharedValue(0.3);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    const timeout = setTimeout(() => {
      scale.value = withRepeat(
        withTiming(1, { duration: 2000, easing: REasing.out(REasing.ease) }),
        -1,
        false,
      );
      opacity.value = withRepeat(
        withTiming(0, { duration: 2000, easing: REasing.out(REasing.ease) }),
        -1,
        false,
      );
    }, delay);
    return () => clearTimeout(timeout);
  }, [delay, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Reanimated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: RING_COLOR,
          backgroundColor: `${RING_COLOR}1A`,
        },
        style,
      ]}
    />
  );
}

// ETA numeral roll — old value exits upward, new value rises in from below.
// Exit faster than enter so the digits never read as doubled; tabular-nums
// on the Text keeps the width fixed so nothing else shifts.
const DigitExit = new Keyframe({
  from: { opacity: 1, transform: [{ translateY: 0 }] },
  to: { opacity: 0, transform: [{ translateY: -8 }] },
}).duration(160);
const DigitEnter = new Keyframe({
  from: { opacity: 0, transform: [{ translateY: 8 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
}).duration(220);

// Chrome entrance — fade + small drop, staggered back→pill, once per mount.
const chromeEnter = (delay: number) =>
  new Keyframe({
    from: { opacity: 0, transform: [{ translateY: -8 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  })
    .duration(220)
    .delay(delay);

export default function TrackingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // IMPORTANT: select with a getter so the reference stays stable across
  // unrelated state changes. `useBookingStore()` (no selector) returns the
  // entire store snapshot on every render, which made `setActiveBooking`
  // a fresh reference every time and re-fired the fetch effect — causing
  // 3-4 redundant /bookings/{id} + /track requests per visit.
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
  // Draft mutators for the no_runner "Book again" path — mirrors
  // book/confirm's exhausted-rebook (re-seed the draft, land on review).
  const updateDraft = useBookingStore((s) => s.updateDraft);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const setBookingStep = useBookingStore((s) => s.setStep);
  // Read the booking already in the store (set by home's activeBookingQ)
  // so we can render instantly while the fresh /bookings/{id} fetch
  // revalidates in the background. Avoids the skeleton flash when the
  // user taps the active booking card on the home screen.
  const cachedBooking = useBookingStore((s) =>
    s.activeBooking && s.activeBooking.id === id ? s.activeBooking : null,
  );
  const refreshUnread = useChatStore((s) => s.refreshUnread);
  const unreadForBooking = useChatStore(
    (s) => (id ? s.unreadByBooking[id] ?? 0 : 0),
  );

  const [booking, setBooking] = useState<Booking | null>(cachedBooking);
  const [statusLogs, setStatusLogs] = useState<BookingStatusLog[]>(
    cachedBooking?.status_logs ?? [],
  );
  const [loading, setLoading] = useState(!cachedBooking);
  // Distinguishes a genuine 404 (no such errand) from a transient
  // fetch/network failure. Without this, a dropped request fell through
  // to the misleading "not found" dead-end with no retry. Holds the error
  // itself, so the screen can say offline vs gone.
  const [loadError, setLoadError] = useState<unknown>(null);
  // The live alert for THIS errand, from the per-errand record sosIntent
  // writes on the server's ack — so leaving and reopening the screen keeps the
  // card (and its "I'm safe" control). A record with resolvedAt is an alert
  // somebody else closed: staff, or the server no longer has it open.
  const sosRecord = useSosActive(id);
  const sosActive = !!sosRecord && !sosRecord.resolvedAt;
  const sosResolved = !!sosRecord?.resolvedAt;
  // SlideToConfirm latches after a completed slide (its completedRef never
  // re-arms itself); bump this key on a FAILED stand-down so the slider
  // remounts fresh and the retry the toast promises actually works — mirrors
  // the runner errand screen's slideResetKey.
  const [standDownResetKey, setStandDownResetKey] = useState(0);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  // null = idle, 'loading' = first fetch in flight, 'error' = last fetch
  // failed (e.g. 401/429/network). Surfaces a user-facing retry chip.
  const [routeFetchState, setRouteFetchState] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  // True once THIS screen cancelled the errand, so the status watcher's
  // "this errand was cancelled" toast stays for remote cancellations (admin,
  // auto-cancel, runner-side) only.
  const selfCancelledRef = useRef(false);
  // Trip details (timeline, shopping breakdown, proof photos) collapse
  // by default so the bottom sheet stays uncluttered. Customers who
  // want the verbose breakdown tap "Trip details" to expand. We keep
  // the toggle in component state — no global store, no animation lib —
  // so reopening the screen restores the default minimal view.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // GET /bookings/{id}/cancel-preview — what cancelling costs AND what comes
  // back (see utils/cancelPreview).
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // The preview request failed. The confirm then says a fee MAY apply (once a
  // runner accepted) and offers a re-check, instead of generic copy that let
  // the customer agree without ever seeing the fee.
  const [previewFailed, setPreviewFailed] = useState(false);
  // Only the newest preview request may write its answer — one still in
  // flight from an earlier open of the dialog must not overwrite it.
  const previewSeqRef = useRef(0);
  const [showSOSModal, setShowSOSModal] = useState(false);
  const [sosSubmitting, setSosSubmitting] = useState(false);
  // Cached trusted contacts (@trusted_contacts_cache, written by the
  // trusted-contacts screen). null = not yet read / never visited. It tunes the
  // SOS modal's honesty copy AND — the reason we now keep the whole rows, not
  // just a count — powers tap-to-call in the no-signal fallback, where a voice
  // call is the only thing that still works. Cache-only, no network: we never
  // block the emergency flow on a fetch.
  const [trustedContacts, setTrustedContacts] = useState<
    SosCallableContact[] | null
  >(null);
  const trustedCount = trustedContacts?.length ?? null;
  // The queued (not-yet-acknowledged) SOS for THIS booking, and whether an
  // attempt is in flight. Both live in the sosIntent store so they survive this
  // screen unmounting mid-emergency.
  const queuedSos = useSosIntentStore((s) =>
    id && s.intent?.bookingId === id ? s.intent : null,
  );
  const sosSending = useSosIntentStore((s) => s.sending);
  const sosAck = useSosIntentStore((s) => (id && s.lastAck?.bookingId === id ? s.lastAck : null));
  const sosRejection = useSosIntentStore((s) =>
    id && s.lastRejection?.bookingId === id ? s.lastRejection : null,
  );
  const [showSosPending, setShowSosPending] = useState(false);
  // sosNow ticks the elapsed clock; deactivatingSOS locks the "I'm safe" slide.
  // Full-size proof-photo preview. Opened IN-APP (bearer-aware ImageLightbox)
  // rather than Linking.openURL, which hands a gated /internal/media URL to the
  // OS browser with no auth header → guaranteed 403.
  const [proofPhotoUri, setProofPhotoUri] = useState<string | null>(null);
  const [sosNow, setSosNow] = useState(() => Date.now());
  const [deactivatingSOS, setDeactivatingSOS] = useState(false);

  // Read the cached trusted contacts once so the SOS modal can tell the truth
  // about who actually gets alerted, and so the no-signal fallback can offer
  // their numbers. Cache-only, no network. Unknown/malformed cache leaves the
  // list null (treated as zero) — we never promise contacts we can't confirm.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem('@trusted_contacts_cache')
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) return;
          setTrustedContacts(
            parsed
              .filter(
                (c: any) =>
                  c && typeof c.phone === 'string' && c.phone.trim().length > 0,
              )
              .map((c: any) => ({
                id: typeof c.id === 'string' ? c.id : undefined,
                name:
                  typeof c.name === 'string' && c.name.trim()
                    ? c.name.trim()
                    : 'Trusted contact',
                phone: String(c.phone).trim(),
              })),
          );
        } catch {
          // Malformed cache — leave the list null (treated as zero).
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick an SOS back up that never reached the server (app killed mid-request,
  // or still queued from a dead zone). Resuming is what makes the retry loop
  // outlive this screen; the server's active-alert idempotency makes it free.
  // The acknowledged-alert records are loaded alongside, so a live alert's
  // card is back the moment the screen is.
  useEffect(() => {
    void resumeSosIntent();
    void hydrateSosActive();
  }, []);

  // A queued raise that lands on a BACKGROUND retry has to reach this screen —
  // otherwise it keeps saying "not sent yet" about an alert that is now live.
  // The card itself renders from the record the ack wrote; this only closes
  // the dialogs that were waiting on it.
  useEffect(() => {
    if (!sosAck) return;
    setSosNow(Date.now());
    setShowSosPending(false);
    setShowSOSModal(false);
  }, [sosAck]);

  // The server refused it outright (errand closed, or no longer ours) while we
  // were retrying. Say so instead of leaving a promise on screen.
  useEffect(() => {
    if (!sosRejection || !id) return;
    setShowSosPending(false);
    toast.error(describeSosFailure(sosRejection.error));
    acknowledgeSosRejection(id);
  }, [sosRejection, id]);

  // Tick the elapsed clock once a second while an SOS is live so the
  // stand-down card's "active for" readout stays current. Runs only while
  // sosActive — a finished/cancelled alert holds no timer.
  useEffect(() => {
    if (!sosActive) return;
    setSosNow(Date.now());
    const t = setInterval(() => setSosNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sosActive]);
  // HERE tiles are billable, so the map mounts on a phase gate instead of a
  // blanket opt-in: auto-mount during the en-route phases (MAP_PHASES),
  // ref-latched hold through the arrived_* pauses, never on terminal
  // statuses. `mapOverride` is the user's escape hatch in BOTH directions —
  // 'on' pre-dispatch (old "View live map"), 'off' during auto phases
  // ("Hide map"). null follows the gate. Per-visit state, like old showMap.
  const [mapOverride, setMapOverride] = useState<'on' | 'off' | null>(null);
  // Hysteresis latch: set while in an auto phase, held through arrived_* so
  // the arrive→pickup boundary never unmounts/remounts tiles. A cold start
  // directly INTO arrived_* leaves it false → opt-in pill, no auto-mount.
  const mapLatchRef = useRef(false);
  useEffect(() => {
    if (!booking) return;
    if (MAP_PHASES.includes(booking.status)) mapLatchRef.current = true;
    if (TERMINAL_UI.includes(booking.status)) mapLatchRef.current = false;
    // Keyed on status only — other booking-field updates can't move the latch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.status]);

  // Derived map gate. Plain consts (no memo): they must re-evaluate on every
  // render that follows a status change, and each input is cheap.
  const bookingStatus = booking?.status ?? null;
  const isTerminalUi = bookingStatus != null && TERMINAL_UI.includes(bookingStatus);
  // A GCash/Maya booking the server holds back from runners until it's paid.
  // Still `pending`, but nobody is being looked for — see utils/bookingPayment.
  const awaitingPayment = isAwaitingPayment(booking);
  const mapAuto =
    bookingStatus != null &&
    (MAP_PHASES.includes(bookingStatus) ||
      (HOLD_PHASES.includes(bookingStatus) && mapLatchRef.current));
  // Terminal wins over everything (even override 'on'): no tiles for a
  // finished trip. Then the user's override, then the auto gate.
  const mapMounted =
    bookingStatus != null &&
    !isTerminalUi &&
    (mapOverride === 'off' ? false : mapOverride === 'on' ? true : mapAuto);

  const mapRef = useRef<HereMapViewRef>(null);

  // Gradient→map veil: the brand gradient stays mounted ABOVE the map while
  // MapLibre loads its style + first tiles, then fades out on onMapReady or
  // a 1.5s timeout, whichever fires first. Never dropped early — before
  // onDidFinishLoadingMap MapLibre shows a grey checkerboard.
  // Initialised to `mapMounted` so a cold deep-link straight into map mode
  // is covered on the very first frame, not one effect-tick later.
  const [veilVisible, setVeilVisible] = useState<boolean>(mapMounted);
  const veilOpacity = useRef(new Animated.Value(1)).current;
  const veilTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const veilDismissedRef = useRef(false);
  const dismissVeil = useCallback(() => {
    if (veilDismissedRef.current) return;
    veilDismissedRef.current = true;
    if (veilTimerRef.current) {
      clearTimeout(veilTimerRef.current);
      veilTimerRef.current = null;
    }
    if (reduceMotion) {
      setVeilVisible(false);
      veilOpacity.setValue(1);
      return;
    }
    Animated.timing(veilOpacity, {
      toValue: 0,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setVeilVisible(false);
        // Re-prime for the next mount (map hidden then re-shown): the veil's
        // synchronous first frame below must render at full opacity.
        veilOpacity.setValue(1);
      }
    });
  }, [reduceMotion, veilOpacity]);
  const prevMapMountedRef = useRef(false);
  useEffect(() => {
    const prev = prevMapMountedRef.current;
    prevMapMountedRef.current = mapMounted;
    if (mapMounted && !prev) {
      veilDismissedRef.current = false;
      veilOpacity.setValue(1);
      setVeilVisible(true);
      veilTimerRef.current = setTimeout(dismissVeil, 1500);
    } else if (!mapMounted && prev) {
      if (veilTimerRef.current) {
        clearTimeout(veilTimerRef.current);
        veilTimerRef.current = null;
      }
      veilDismissedRef.current = false;
      setVeilVisible(false);
    }
  }, [mapMounted, dismissVeil, veilOpacity]);
  useEffect(
    () => () => {
      if (veilTimerRef.current) clearTimeout(veilTimerRef.current);
    },
    [],
  );

  // The receipt IS the point of a terminal trip — pop the details section
  // (reconciliation, proofs) open once on entering a terminal status. Ref
  // guard, not state-derived, so the user can still re-collapse it.
  const detailsAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (isTerminalUi && !detailsAutoOpenedRef.current) {
      detailsAutoOpenedRef.current = true;
      setDetailsOpen(true);
    }
  }, [isTerminalUi]);

  // Tracks the last booking status we have already loaded statusLogs for.
  // Used to skip redundant /track refetches when realtime UPDATEs come in
  // for unrelated fields. Declared before the fetch effect that seeds it.
  const lastSyncedStatusRef = useRef<BookingStatus | null>(null);

  // Live runner location via Reverb realtime. Tear the channel down once the
  // trip is terminal — a completed/cancelled booking still carries a runner_id,
  // so without the !isTerminalUi guard the receipt would hold an idle websocket
  // open for its whole dwell time. (P13)
  const { runnerLocation, isConnected } = useRunnerTracking(
    booking?.runner_id && !isTerminalUi ? (id ?? null) : null,
  );

  // Looping pulse driver shared between the on-map runner marker and
  // the "live" pill. Only animates while the runner has a positive speed
  // reading so the pulse reads as actual movement. Under Reduce Motion the
  // loop never starts — consumers render a static 0.25-opacity halo instead.
  const runnerPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const moving = runnerLocation?.speed != null && runnerLocation.speed > 0;
    if (!moving || reduceMotion) {
      runnerPulse.stopAnimation();
      runnerPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(runnerPulse, {
        toValue: 1,
        duration: 1400,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [runnerLocation?.speed, runnerPulse, reduceMotion]);

  // Live booking status updates via Reverb realtime
  const { isConnected: statusConnected } = useBookingStatus(id ?? null);

  // Seed last-known runner location from /track once a runner has been
  // assigned. Without this, a customer opening the tracking screen on a
  // cold app start sees an empty map until the runner emits the next
  // GPS update (up to ~30s later, longer if the runner is stationary).
  // We intentionally call /track only when there is a runner_id and we
  // don't already have a runnerLocation in the shared store.
  const setRunnerLocation = useLocationStore((s) => s.setRunnerLocation);
  const seededRunnerLocRef = useRef(false);
  useEffect(() => {
    if (seededRunnerLocRef.current) return;
    if (!id || !booking?.runner_id) return;
    if (runnerLocation) {
      seededRunnerLocRef.current = true;
      return;
    }
    seededRunnerLocRef.current = true;
    bookingService
      .trackBooking(id, { onlyLocation: true })
      .then((res) => {
        const loc = res.data?.data?.runner_location;
        if (loc?.lat != null && loc?.lng != null) {
          setRunnerLocation({
            id: 'seed',
            booking_id: id,
            runner_id: booking.runner_id ?? '',
            lat: Number(loc.lat),
            lng: Number(loc.lng),
            heading: loc.heading ?? null,
            speed: loc.speed ?? null,
            accuracy: null,
            created_at: loc.updated_at ?? new Date().toISOString(),
          });
        }
      })
      .catch(() => {});
  }, [id, booking?.runner_id, runnerLocation, setRunnerLocation]);

  // Fetch booking data.
  // The /bookings/{id} response already includes statusLogs (loaded by
  // BookingController::show), so we DO NOT also call /track here — that
  // would double the network round-trips on every mount. /track is only
  // useful for the latest runner_location, which we get via realtime
  // (useRunnerTracking) in steady state.
  const fetchBooking = useCallback(() => {
    if (!id) return;
    setLoadError(null);
    bookingService
      .getBooking(id)
      .then((bookingRes) => {
        const b = bookingRes.data.data;
        setBooking(b);
        setActiveBooking(b);
        setStatusLogs(b?.status_logs ?? []);
        // A fresh read that says no alert is open closes a stale card.
        reconcileSosActive(id, b?.sos_triggered);
        // Seed the realtime guard so the very first realtime UPDATE
        // (which carries the same status we just loaded) does not
        // trigger a redundant /track refetch.
        lastSyncedStatusRef.current = b?.status ?? null;
      })
      // Flag the failure instead of swallowing it so the UI can offer a
      // retry rather than falling through to "Errand not found".
      .catch((err) => setLoadError(err ?? new Error('load failed')))
      .finally(() => setLoading(false));
  }, [id, setActiveBooking]);

  const retryLoad = useCallback(() => {
    setLoading(true);
    fetchBooking();
  }, [fetchBooking]);

  // Warm the tracked errand's chat thread once a runner is assigned — this is
  // by far the most likely conversation the user opens from here, so opening it
  // shows history immediately instead of ChatThreadSkeleton. Replaces the old
  // blanket cold-start top-4 warm; guarded on runner_id (no runner ⇒ no chat).
  // prefetchChatMessages self-guards against clobbering an open thread. (P25)
  useEffect(() => {
    if (id && booking?.runner_id) {
      void prefetchChatMessages(id);
    }
  }, [id, booking?.runner_id]);

  useEffect(() => {
    if (!id) return;
    // Only show the skeleton if we don't already have a cached snapshot.
    if (!cachedBooking) setLoading(true);
    fetchBooking();
    // cachedBooking intentionally omitted — we only want to fire the fetch
    // when the route id changes, not when the store updates afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, setActiveBooking]);

  // While an SOS is live, re-read the booking now and then so an alert closed
  // elsewhere (staff, or a missed "resolved" notification) doesn't leave the
  // card claiming "SOS active". Rare state, so a plain 30s tail is fine.
  useSmartPolling(
    () => {
      if (!id) return;
      return bookingService.getBooking(id).then((res) => {
        const fresh = res.data?.data as Booking | undefined;
        if (fresh) reconcileSosActive(id, fresh.sos_triggered);
      });
    },
    { interval: 30_000, enabled: !!id && sosActive, runOnMount: false },
  );

  // Poll chat unread counts every 30s while on the tracking screen so the
  // chat badge stays fresh without a websocket. Refresh once on mount too.
  // useSmartPolling pauses it while backgrounded/offline and ticks on
  // reconnect. (backoffOnError:false — refreshUnread swallows its own errors,
  // so there's nothing to back off from.)
  useSmartPolling(refreshUnread, { interval: 30_000, backoffOnError: false });

  // Waiting for a GCash/Maya payment: its confirmation leaves the status at
  // `pending`, so no realtime event announces it and there is no runner for
  // the /track poll below to follow. Tail the booking instead — every 10s and
  // on each return to the app (when a customer comes back from GCash/Maya).
  useSmartPolling(
    () => {
      if (!id) return;
      return bookingService.getBooking(id).then((res) => {
        const fresh = res.data?.data as Booking | undefined;
        if (fresh) setActiveBooking(fresh);
      });
    },
    { interval: 10_000, enabled: !!id && awaitingPayment, runOnMount: false },
  );

  // "Complete payment" — reopens this booking's own checkout and verifies the
  // outcome; a verdict re-reads the booking, since a confirmed payment is what
  // sends it to runners. A charge the server ruled on (declined, expired,
  // refunded) cancels the errand, so the overlay offers Book again instead of
  // reopening a dead checkout. Wrapped: handleRebook is declared further down
  // and only runs on a press, after this render.
  const {
    checkoutUrl,
    completePayment,
    opening: openingCheckout,
    progress: checkoutProgress,
  } = useCompleteBookingPayment(booking, {
    onSettled: fetchBooking,
    onRebook: () => handleRebook(),
  });

  // Polling fallback for the runner's live position. Reverb realtime
  // is the primary path (useRunnerTracking) but in production we have
  // observed cases where the channel reports SUBSCRIBED yet never
  // delivers payloads (dropped socket, failed broadcasting-auth, or
  // idle websocket eviction, etc.). We
  // adapt the poll cadence to the realtime health: when BOTH the
  // location channel and the booking-status channel are connected we
  // tail the server every 20s purely as a sanity reconcile; if either
  // channel is silent we drop back to 5s so the pin keeps moving.
  // This mirrors Grab's "always live" feel in the failure mode while
  // collapsing happy-path traffic 4\u00d7 (12 GETs/min \u2192 3).
  const realtimeHealthy = isConnected && statusConnected;
  const trackPollMs = realtimeHealthy ? 20_000 : 5_000;
  useSmartPolling(
    () => {
      if (!id || !booking?.runner_id || isTerminalUi) return;
      // Return the promise (no swallow-catch) so a failed reconcile propagates
      // to useSmartPolling → exponential backoff instead of hammering a
      // struggling endpoint; a success snaps the cadence back to trackPollMs.
      // Migrated off useForegroundInterval to also pause while offline. (P29)
      return bookingService
        .trackBooking(id, { onlyLocation: true })
        .then((res) => {
          const data = res.data?.data;
          const loc = data?.runner_location;
          if (loc?.lat != null && loc?.lng != null) {
            setRunnerLocation({
              id: 'poll',
              booking_id: id,
              runner_id: booking.runner_id ?? '',
              lat: Number(loc.lat),
              lng: Number(loc.lng),
              heading: loc.heading ?? null,
              speed: loc.speed ?? null,
              accuracy: null,
              created_at: loc.updated_at ?? new Date().toISOString(),
            });
          }
          // The lean poll carries `status` but not a full booking. On an
          // actual change, pull the full booking once and push it into the
          // store — routing through the same realtime-driven `activeBooking`
          // watcher above, which fires the status-change toasts + status-log
          // refresh. Steady-state ticks stay lean; only a transition (rare)
          // costs the full fetch.
          if (data?.status && data.status !== booking.status) {
            bookingService
              .trackBooking(id)
              .then((full) => {
                const fresh = full.data?.data?.booking;
                if (fresh) setActiveBooking(fresh);
              })
              .catch(() => {});
          }
        });
    },
    {
      interval: trackPollMs,
      // Stop polling /track once the booking is terminal — the poll keyed only
      // on runner presence before, and terminal bookings keep their runner_id,
      // so a finished-trip receipt kept hitting /track every 5–20s. (P13)
      enabled: !!id && !!booking?.runner_id && !isTerminalUi,
      runOnMount: true,
      // Cap the failure backoff so a live delivery's pin can't drift stale for
      // minutes if the endpoint blips (default would be trackPollMs × 8). (P29)
      maxInterval: 60_000,
    },
  );

  // Degraded-path fallback for shopping ticks. The live path is the
  // `shopping_items_updated` broadcast handled further down; when Reverb is
  // the thing that's down, that never arrives and the lean /track poll carries only
  // `status`, which a tick never moves. So while a shopping errand is actually
  // being shopped AND realtime is unhealthy, tail the full booking on a slow
  // cadence. Deliberately narrow: shopping errands only, only in the pre-pickup
  // shopping window, only when realtime has already failed us — everything else
  // keeps riding the lean poll. useSmartPolling pauses it while backgrounded or
  // offline, same as its siblings.
  const hasShoppingItems = (booking?.shopping_items?.length ?? 0) > 0;
  const isShoppingWindow =
    !!booking && SHOPPING_TICK_STATUSES.includes(booking.status);
  useSmartPolling(
    () => {
      if (!id) return;
      return bookingService
        .getBooking(id)
        .then((res) => {
          const fresh = res.data?.data as Booking | undefined;
          if (fresh) setActiveBooking(fresh);
        });
    },
    {
      interval: 45_000,
      enabled: !!id && hasShoppingItems && isShoppingWindow && !realtimeHealthy && !isTerminalUi,
      runOnMount: false,
      maxInterval: 180_000,
    },
  );

  // Phase-aware route target. While the runner is heading to the
  // pickup, drawing a static pickup→dropoff polyline is misleading —
  // the customer cares about runner→pickup. Once the parcel is in
  // hand we switch the line to dropoff.
  const pickupLng = booking?.pickup_lng != null ? Number(booking.pickup_lng) : null;
  const pickupLat = booking?.pickup_lat != null ? Number(booking.pickup_lat) : null;
  const dropoffLng = booking?.dropoff_lng != null ? Number(booking.dropoff_lng) : null;
  const dropoffLat = booking?.dropoff_lat != null ? Number(booking.dropoff_lat) : null;

  // Statuses where the runner is still travelling toward the pickup.
  // Anything past `picked_up` means the pickup leg is done and we
  // should be tracking progress toward the dropoff (or, for
  // single-location errands, the same pin).
  const isPickupPhase = booking
    ? ['pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup'].includes(
        booking.status,
      )
    : true;
  const targetLat = isPickupPhase ? pickupLat : dropoffLat;
  const targetLng = isPickupPhase ? pickupLng : dropoffLng;

  // Origin for the route + ETA: the live runner position when we have
  // it, otherwise fall back to the static pickup→dropoff line so the
  // user still sees *something* during pre-dispatch.
  const routeOrigin = useMemo(() => {
    if (runnerLocation) {
      return { lng: Number(runnerLocation.lng), lat: Number(runnerLocation.lat) };
    }
    if (isPickupPhase && pickupLat && pickupLng) {
      return { lng: pickupLng, lat: pickupLat };
    }
    return null;
  }, [runnerLocation, isPickupPhase, pickupLat, pickupLng]);

  // Snap the origin to ~110m so we don't burn Directions calls on every
  // GPS tick. Same trick as `useEta`.
  const routeOriginKey = routeOrigin
    ? `${routeOrigin.lat.toFixed(3)},${routeOrigin.lng.toFixed(3)}`
    : '';

  useEffect(() => {
    // Decide which segment to draw based on what data we actually have.
    // The previous logic merged the pre-dispatch fallback with the
    // live-runner case and ended up sending Directions a degenerate
    // pickup\u2192pickup pair (returns no geometry, leaves the line blank).
    //
    //   live runner   \u2192 runner \u2192 (pickup or dropoff depending on phase)
    //   no runner yet \u2192 pickup \u2192 dropoff (so the customer still sees the
    //                  trip shape they're booking)
    let from: { lat: number; lng: number } | null = null;
    let to: { lat: number; lng: number } | null = null;
    if (runnerLocation && targetLat && targetLng) {
      from = { lat: Number(runnerLocation.lat), lng: Number(runnerLocation.lng) };
      to = { lat: targetLat, lng: targetLng };
    } else if (pickupLat && pickupLng && dropoffLat && dropoffLng) {
      from = { lat: pickupLat, lng: pickupLng };
      to = { lat: dropoffLat, lng: dropoffLng };
    }
    if (!from || !to) return;
    // Bail when origin and destination are within ~30m \u2014 Directions
    // returns an empty geometry that wipes the polyline.
    const dLat = (to.lat - from.lat) * 111_000;
    const dLng = (to.lng - from.lng) * 111_000 * Math.cos((from.lat * Math.PI) / 180);
    if (Math.sqrt(dLat * dLat + dLng * dLng) < 30) return;
    let cancelled = false;
    setRouteFetchState('loading');
    routeService
      .getRoute({ lng: from.lng, lat: from.lat }, { lng: to.lng, lat: to.lat }, 'driving', {
        // From the runner it shares the ETA's live entry; pickup→drop-off is
        // two fixed pins.
        liveOrigin: !!(runnerLocation && targetLat && targetLng),
      })
      .then((res) => {
        if (cancelled) return;
        if (res) {
          setRouteCoords(res.coordinates);
          setRouteFetchState('idle');
        } else {
          setRouteFetchState('error');
        }
      });
    return () => {
      cancelled = true;
    };
    // routeOrigin omitted \u2014 routeOriginKey covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOriginKey, targetLat, targetLng, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  // Live ETA from the runner to whichever pin matters in this phase.
  // Re-uses the same Directions cache as the polyline above.
  const eta = useEta(
    runnerLocation
      ? { lat: Number(runnerLocation.lat), lng: Number(runnerLocation.lng) }
      : null,
    targetLat && targetLng ? { lat: targetLat, lng: targetLng } : null,
  );

  // "Almost there" cue — fire a single soft haptic the first time the
  // runner is within 250m of the active pin in a given phase. Resets on
  // phase change so the dropoff arrival also gets its own buzz.
  //
  // Screen-local ONLY: the backgrounded case belongs to the server's
  // approach push (LocationService fires one per leg at ~300m). Scheduling
  // a device notification here too would land a second banner seconds after
  // that one for the same event, so this stays a toast + haptic.
  const arrivalCueRef = useRef<string | null>(null);
  useEffect(() => {
    if (eta.distanceMeters == null) return;
    const phaseKey = `${booking?.id ?? ''}:${isPickupPhase ? 'p' : 'd'}`;
    if (eta.distanceMeters < 250 && arrivalCueRef.current !== phaseKey) {
      arrivalCueRef.current = phaseKey;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const msg = isPickupPhase
        ? 'Runner is arriving at pickup'
        : 'Runner is almost at the dropoff';
      toast.success(msg);
    }
    // Clear the latch when the runner is back outside the radius (e.g.
    // re-routed) so a second approach can re-trigger.
    if (eta.distanceMeters > 600 && arrivalCueRef.current === phaseKey) {
      arrivalCueRef.current = null;
    }
  }, [eta.distanceMeters, isPickupPhase, booking?.id]);

  // Force-refresh the route polyline (bypasses the route cache).
  // Wired to the "Couldn't load route" retry chip below the map.
  const retryRoute = useCallback(async () => {
    let from: { lat: number; lng: number } | null = null;
    let to: { lat: number; lng: number } | null = null;
    if (runnerLocation && targetLat && targetLng) {
      from = { lat: Number(runnerLocation.lat), lng: Number(runnerLocation.lng) };
      to = { lat: targetLat, lng: targetLng };
    } else if (pickupLat && pickupLng && dropoffLat && dropoffLng) {
      from = { lat: pickupLat, lng: pickupLng };
      to = { lat: dropoffLat, lng: dropoffLng };
    }
    if (!from || !to) return;
    setRouteFetchState('loading');
    const res = await routeService.refreshRoute(
      { lng: from.lng, lat: from.lat },
      { lng: to.lng, lat: to.lat },
      'driving',
      { liveOrigin: !!(runnerLocation && targetLat && targetLng) },
    );
    if (res) {
      setRouteCoords(res.coordinates);
      setRouteFetchState('idle');
    } else {
      setRouteFetchState('error');
      toast.error('Still no luck \u2014 check your connection');
    }
  }, [runnerLocation, targetLat, targetLng, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  // React to realtime booking status updates from useBookingStatus
  const activeBooking = useBookingStore((s) => s.activeBooking);
  useEffect(() => {
    if (!activeBooking || !id) return;
    setBooking(activeBooking);
    // Only refresh status logs when the status actually changed — otherwise
    // every minor field update on the booking row would refetch /track.
    if (activeBooking.status !== lastSyncedStatusRef.current) {
      const prev = lastSyncedStatusRef.current;
      lastSyncedStatusRef.current = activeBooking.status;
      bookingService.trackBooking(id).then((trackRes) => {
        // The FULL /track payload nests the booking under `booking`
        // (data.data.booking) — status_logs lives on that BookingResource, not
        // at data.data. Reading it one level too shallow returned undefined, so
        // this wiped the mount-seeded timeline to [] on every status change and
        // the per-stage timestamps vanished until remount. (Cf. the correct
        // `full.data?.data?.booking` read ~200 lines above.)
        const fresh = trackRes.data.data?.booking as Booking | undefined;
        setStatusLogs(fresh?.status_logs ?? []);
        // ...and keep the FULL booking we just paid for. This used to extract
        // status_logs and throw the rest away, so every field that only ever
        // changes ALONGSIDE a transition — actual_item_cost, receipt_photo_url,
        // pickup/delivery proof photos, all written in the same PATCH that
        // moves the errand to picked_up/delivered — stayed at its mount value
        // until the customer backed out of the screen and re-entered.
        // BookingStatusChanged only broadcasts lifecycle fields, so realtime
        // could never supply them either. Writing through the store re-enters
        // this same effect with the status unchanged, which is a no-op past the
        // guard above — no refetch loop.
        if (fresh) setActiveBooking(fresh);
      }).catch(() => {});

      // User-visible confirmation that something happened. Without this
      // the customer has no idea the runner accepted unless they happen
      // to be staring at the timeline pill. Push notifications cover
      // backgrounded users; this covers the foreground case.
      if (prev != null) {
        // Success haptic on the meaningful forward transitions so the
        // customer feels the progress even without looking at the screen.
        if (
          ['matched', 'accepted', 'arrived_at_pickup', 'arrived_at_dropoff'].includes(
            activeBooking.status,
          )
        ) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        const runnerName = activeBooking.runner?.full_name ?? 'Your runner';
        switch (activeBooking.status) {
          case 'matched':
            toast.success(`${runnerName} was matched to your errand`);
            break;
          case 'accepted':
            toast.success(`${runnerName} accepted your errand`);
            break;
          case 'heading_to_pickup':
            toast.info(`${runnerName} is on the way to pickup`);
            break;
          case 'arrived_at_pickup':
            toast.info(`${runnerName} arrived at pickup`);
            break;
          case 'picked_up':
          case 'in_transit':
            toast.info(`${runnerName} is heading to dropoff`);
            break;
          case 'arrived_at_dropoff':
            toast.info(`${runnerName} arrived at dropoff`);
            break;
          // Every forward transition was announced; the two ways an errand
          // ENDS without the customer doing anything were not. An admin or
          // auto-cancel used to morph the screen from "Finding you a runner"
          // to "Cancelled" in silence. Suppressed for the customer's own
          // cancel, which already toasts the server's money receipt.
          case 'cancelled':
            if (!selfCancelledRef.current) {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
              ).catch(() => {});
              toast.error(
                wasCancelledForUnpaidPayment(activeBooking)
                  ? "Your payment wasn't completed, so this errand was cancelled."
                  : 'This errand was cancelled. See the receipt below.',
              );
            }
            break;
          case 'no_runner':
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Warning,
            ).catch(() => {});
            // No money claim in the toast — a prepaid booking's fare IS
            // auto-refunded here, so "nothing was charged" would be a lie.
            // The receipt below states what happened to it.
            toast.error('No runner was available for this errand.');
            break;
          default:
            break;
        }
      }

      // Sweep the customer to the rating screen ONLY on a real live
      // completion they just watched happen. This used to sit outside the
      // status-changed guard, so it also fired from the mount fetch — which
      // meant a completed errand's receipt was unreachable forever: every
      // route into tracking (Activity → "View full details", search, a
      // notification tap) bounced straight to /rate, and the proof photos,
      // signature, shopping reconciliation and stage timeline live nowhere
      // else. Worse, on an already-rated errand /rate re-renders an empty
      // form whose Submit 422s "already reviewed" for good.
      //   - prev != null && prev !== 'completed' → a transition, not a mount
      //     seed or a re-delivery of the same status.
      //   - !hasReview → an errand rated three days ago opens as its
      //     receipt; the receipt carries its own "Rate your runner" CTA when
      //     a rating is still owed, so rate stays reachable on purpose.
      if (
        activeBooking.status === 'completed' &&
        prev != null &&
        prev !== 'completed' &&
        !bookingReview(activeBooking)
      ) {
        router.replace(`/(customer)/rate/${id}`);
      }
    }
  }, [activeBooking, id, router, setActiveBooking]);

  // ── Runner's shopping + stop ticks, live ──────────────────────────────
  // The runner's PATCH /runner/errand/{id}/shopping-items pushes the WHOLE
  // refreshed checklist to the customer as an in-app `shopping_items_updated`
  // notification (ShoppingChecklistController → notifyInAppCoalesced — in-app
  // only, no device buzz per tick); a ticked-off extra stop arrives the same way as
  // `booking_stops_updated`. The app-wide realtime handler already lands those
  // rows in the notification store, so we read them from there rather than
  // opening a second socket for the same channel, and patch the booking in
  // place: the payload IS the new state, so a tick costs zero requests.
  //
  // The server COALESCES each stream onto one card per errand and re-broadcasts
  // it with the same id on every tick, so a tick is recognised by the card's
  // CONTENT changing (utils/liveProgressCards), never by a new id — keying on
  // the id froze the checklist after the first tick.
  //
  // Ticks never move `status`, which is why nothing else on this screen could
  // ever see them — the realtime watcher above and the reconcile poll both key
  // their full refetch on a status CHANGE.
  const shoppingCard = useNotificationStore((s) =>
    latestProgressCard(s.notifications, SHOPPING_ITEMS_UPDATED, id),
  );
  const stopsCard = useNotificationStore((s) =>
    latestProgressCard(s.notifications, BOOKING_STOPS_UPDATED, id),
  );
  const appliedCardsRef = useRef<{ id: string; shopping: string | null; stops: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!id) return;
    const shoppingSig = progressCardSignature(shoppingCard);
    const stopsSig = progressCardSignature(stopsCard);
    // The cards held when this screen (or errand) opens predate it — the mount
    // fetch already loaded authoritative shopping_items and stops. Arm on the
    // first pass and react to changes from then on.
    const applied = appliedCardsRef.current;
    if (!applied || applied.id !== id) {
      appliedCardsRef.current = { id, shopping: shoppingSig, stops: stopsSig };
      return;
    }

    // Type/booking/payload validation lives in the pure helpers so it is
    // unit-testable without a socket (utils/shoppingChecklist, stopProgress).
    const patched =
      shoppingSig !== applied.shopping
        ? shoppingItemsFromNotification(
            shoppingCard ? { type: shoppingCard.type, data: shoppingCard.data } : null,
            id,
          )
        : null;
    // The stops payload is partial ({id, sequence, completed_at} — no
    // address), so it merges into the stops the booking already holds rather
    // than replacing them.
    const stopUpdates =
      stopsSig !== applied.stops
        ? stopCompletionsFromNotification(
            stopsCard ? { type: stopsCard.type, data: stopsCard.data } : null,
            id,
          )
        : null;
    applied.shopping = shoppingSig;
    applied.stops = stopsSig;

    if (!patched && !stopUpdates) return;

    // Write through the store, not local state: the home card and the booking
    // detail sheet read the same `activeBooking`, and the watcher above turns
    // it back into this screen's `booking`.
    const current = useBookingStore.getState().activeBooking;
    if (current && current.id === id) {
      const mergedStops = stopUpdates ? mergeStopCompletions(current.stops, stopUpdates) : null;
      if (patched || mergedStops) {
        setActiveBooking({
          ...current,
          ...(patched ? { shopping_items: patched } : null),
          ...(mergedStops ? { stops: mergedStops } : null),
        });
      }
    } else {
      setBooking((prev) => {
        if (!prev || prev.id !== id) return prev;
        const mergedStops = stopUpdates ? mergeStopCompletions(prev.stops, stopUpdates) : null;
        if (!patched && !mergedStops) return prev;
        return {
          ...prev,
          ...(patched ? { shopping_items: patched } : null),
          ...(mergedStops ? { stops: mergedStops } : null),
        };
      });
    }
  }, [shoppingCard, stopsCard, id, setActiveBooking]);

  // Route GeoJSON
  const routeMapCoords = useMemo(() => {
    return routeCoords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  }, [routeCoords]);

  // Camera bounds covering pickup, dropoff, and runner.
  //
  // Performance note: runnerLocation can update every second from the
  // realtime channel. Recomputing `bounds` on every tick re-fires
  // Mapbox.Camera's fit-to-bounds animation, which both burns frame time
  // and creates a "jittery" zoom on every GPS sample. We re-fit when
  // the runner has moved >40m OR ≥3s since the last fit, whichever
  // comes first — tight enough that the pin visibly slides on every
  // poll tick (5s server throttle), loose enough not to thrash the GPU.
  const lastFitRef = useRef<{ ts: number; lat: number; lng: number } | null>(null);
  const [stableRunnerPoint, setStableRunnerPoint] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!runnerLocation) return;
    const now = Date.now();
    const last = lastFitRef.current;
    const lat = Number(runnerLocation.lat);
    const lng = Number(runnerLocation.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    if (!last) {
      lastFitRef.current = { ts: now, lat, lng };
      setStableRunnerPoint({ lat, lng });
      return;
    }

    // Equirectangular approximation \u2014 plenty accurate for sub-km deltas
    // and avoids the cost of full haversine on every tick.
    const dLat = (lat - last.lat) * 111_000;
    const dLng = (lng - last.lng) * 111_000 * Math.cos((lat * Math.PI) / 180);
    const movedMeters = Math.sqrt(dLat * dLat + dLng * dLng);
    const elapsedMs = now - last.ts;

    if (movedMeters > 40 || elapsedMs > 3000) {
      lastFitRef.current = { ts: now, lat, lng };
      setStableRunnerPoint({ lat, lng });
    }
  }, [runnerLocation]);

  const cameraBounds = useMemo(() => {
    if (!booking) return undefined;
    const points: [number, number][] = [];
    if (booking.pickup_lng && booking.pickup_lat) {
      points.push([Number(booking.pickup_lng), Number(booking.pickup_lat)]);
    }
    if (booking.dropoff_lng && booking.dropoff_lat) {
      points.push([Number(booking.dropoff_lng), Number(booking.dropoff_lat)]);
    }
    if (stableRunnerPoint) {
      points.push([stableRunnerPoint.lng, stableRunnerPoint.lat]);
    }
    if (points.length < 2) return undefined;
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    return {
      ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
      sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
      paddingTop: 60,
      paddingBottom: 60,
      paddingLeft: 60,
      paddingRight: 60,
    };
  }, [booking, stableRunnerPoint]);

  // Fit map to all visible points whenever stable bounds change
  useEffect(() => {
    if (!cameraBounds || !mapRef.current) return;
    const coords = [
      { latitude: cameraBounds.ne[1], longitude: cameraBounds.ne[0] },
      { latitude: cameraBounds.sw[1], longitude: cameraBounds.sw[0] },
    ];
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 60, bottom: 60, left: 60, right: 60 },
      animated: !reduceMotion,
    });
  }, [cameraBounds, reduceMotion]);

  // Recenter FAB — re-runs the exact fit above so "recenter" always lands on
  // the same framing the auto-fit chooses, never a subtly different crop.
  const handleRecenter = useCallback(() => {
    if (!cameraBounds || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      [
        { latitude: cameraBounds.ne[1], longitude: cameraBounds.ne[0] },
        { latitude: cameraBounds.sw[1], longitude: cameraBounds.sw[0] },
      ],
      {
        edgePadding: { top: 60, bottom: 60, left: 60, right: 60 },
        animated: !reduceMotion,
      },
    );
  }, [cameraBounds, reduceMotion]);


  const loadCancelPreview = useCallback(() => {
    if (!id) return;
    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    setPreviewFailed(false);
    bookingService
      .cancelPreview(id)
      .then((res) => {
        if (seq !== previewSeqRef.current) return;
        const preview = res?.data?.data ?? null;
        setCancelPreview(preview);
        setPreviewFailed(!preview);
      })
      .catch(() => {
        if (seq !== previewSeqRef.current) return;
        setCancelPreview(null);
        setPreviewFailed(true);
      })
      .finally(() => {
        if (seq === previewSeqRef.current) setPreviewLoading(false);
      });
  }, [id]);

  const handleCancel = useCallback(() => {
    if (!id || isCancelling) return;
    // Warning cue as the destructive confirm surfaces.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setShowCancelModal(true);
    loadCancelPreview();
  }, [id, isCancelling, loadCancelPreview]);

  const confirmCancel = useCallback(async () => {
    if (!id) return;
    // Claim this cancellation as ours so the status watcher doesn't also
    // announce it — confirmCancel already toasts the server's money receipt,
    // and two toasts for one action reads as a bug. Set BEFORE the request so
    // an inbound broadcast can't beat it.
    selfCancelledRef.current = true;
    setIsCancelling(true);
    try {
      // Backend requires `reason` to be present (422 otherwise). The
      // sheet doesn't currently expose a free-text input, so fall back
      // to a clear default that audit logs / refund flows can key off.
      const res = await bookingService.cancelBooking(id, 'Cancelled by customer');
      setActiveBooking(null);
      setShowCancelModal(false);
      router.replace('/(customer)/(tabs)');

      // Show the server's receipt. It states the fee actually charged, the
      // amount refunded and the new wallet balance — deliberately built so a
      // customer is never left wondering where their money went. The app used
      // to throw it away and navigate off in silence, so money moved with no
      // acknowledgement at the one moment trust is most fragile. Toasted
      // AFTER the replace so it lands on the screen the user ends up on.
      const receipt = cancelReceiptMessage(res);
      if (receipt) {
        toast.success(receipt);
      }
    } catch (err) {
      haptics.error();
      toast.error(errorMessage(err, copy.booking.cancelFailed));
    } finally {
      setIsCancelling(false);
    }
  }, [id, setActiveBooking, router]);

  const handleSOS = useCallback(() => {
    if (!id) return;
    // Warning cue as the emergency confirm surfaces.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setShowSOSModal(true);
  }, [id]);

  const confirmSOS = useCallback(async () => {
    // Re-entrancy guard: without an in-flight flag, the modal stays open with
    // the "Trigger SOS" button enabled until the request resolves, so an
    // anxious user can tap it repeatedly and fire concurrent triggerSOS calls
    // with zero feedback. Mirrors the runner-side handleConfirmSOS.
    if (!id || sosSubmitting) return;
    setSosSubmitting(true);
    try {
      // raiseSos persists the intent BEFORE the first attempt and keeps
      // retrying (reconnect edge + timer + foreground) until the server ACKs,
      // so a dead-zone press is no longer lost. It never throws.
      const result = await raiseSos(id, 'customer');
      if (result.status === 'sent') {
        // Who it reached is the SERVER's sentence (or, from an older server,
        // only what it confirmed) — never an assumption. The card renders from
        // the record raiseSos wrote.
        setSosNow(Date.now());
        setShowSOSModal(false);
        haptics.warning();
        // The server's sentence alone — it already says the alert went out
        // ("SOS sent. SOS sent to…" read twice). Same as the runner cockpit.
        toast.success(sosAlertedText(result));
        return;
      }
      if (result.status === 'queued') {
        // NOT sent — say exactly that, keep the alert queued, and put the two
        // things that work without data (911, the cached contacts) one tap away.
        haptics.warning();
        setShowSOSModal(false);
        setShowSosPending(true);
        return;
      }
      // Rejected on the server's own terms — nothing is queued.
      haptics.error();
      toast.error(describeSosFailure(result.error));
      if (id) acknowledgeSosRejection(id);
    } catch (err) {
      // raiseSos is written not to throw; belt AND braces on the one path
      // where an unhandled rejection would leave a person in danger staring
      // at a spinner.
      haptics.error();
      toast.error(describeSosFailure(err));
    } finally {
      setSosSubmitting(false);
    }
  }, [id, sosSubmitting]);

  // "I'm safe" stand-down — deactivateSOS is fully wired server-side. Clears
  // the local active-SOS state on success so the footer returns to the normal
  // SOS/cancel controls. Re-entrancy guarded so a double-slide can't fire two
  // DELETEs.
  const handleStandDown = useCallback(async () => {
    if (!id || deactivatingSOS) return;
    setDeactivatingSOS(true);
    // Drop any UNSENT intent FIRST. A queued replay landing after the customer
    // said "I'm safe" would re-raise the alarm they just cancelled — the one
    // way a retry loop can do harm.
    const { hadUnsentIntent } = standDownSos(id);
    try {
      await bookingService.deactivateSOS(id);
      clearSosActive(id);
      setShowSosPending(false);
      haptics.success();
      toast.success('Alert cancelled — glad you’re safe');
    } catch (err) {
      if (hadUnsentIntent) {
        // Nothing had reached the server, and the intent is now gone, so there
        // is genuinely nothing left to stand down — even though the DELETE
        // (also offline) failed. Don't invite a retry that isn't needed.
        clearSosActive(id);
        setShowSosPending(false);
        haptics.success();
        toast.success('Alert cancelled — it was never sent');
        setDeactivatingSOS(false);
        return;
      }
      haptics.error();
      // Re-arm the (otherwise permanently latched) slider so a retry works.
      setStandDownResetKey((k) => k + 1);
      toast.error(errorMessage(err, 'Couldn’t cancel the alert. Please try again.'));
    } finally {
      setDeactivatingSOS(false);
    }
  }, [id, deactivatingSOS]);

  // Report-a-problem: opens a NEW ticket already linked to this errand
  // (booking_id) with the category picked — the support screen opens its
  // composer straight away instead of landing on the inbox.
  const handleReportProblem = useCallback(
    (category: 'booking' | 'safety') => {
      if (!booking) return;
      haptics.selection();
      router.push({
        pathname: '/(customer)/support',
        params: {
          compose: '1',
          category,
          booking_id: booking.id,
          booking_number: booking.booking_number,
        },
      });
    },
    [booking, router],
  );

  // "Report this person" — the runner on this errand, to ErrandGuy staff.
  const [showReportUser, setShowReportUser] = useState(false);

  const handleCall = useCallback(() => {
    const phone = booking?.runner?.phone ?? null;
    // TODO(spec §10c): replace direct dial with masked-call/VoIP so neither
    // party sees the other's real phone number. Backend dependency — needs
    // a `POST /bookings/{id}/call` endpoint that returns a masked DID, and
    // a Twilio/Telnyx (or local equivalent) provisioning step. Until that
    // ships we fall back to a direct tel: link.
    if (phone) {
      Linking.openURL(`tel:${phone}`).catch(() => toast.error('Could not start call'));
    } else {
      toast.error('Runner phone not available yet');
    }
  }, [booking]);

  const [sharingTrip, setSharingTrip] = useState(false);

  const handleShareTrip = useCallback(async () => {
    if (!id || sharingTrip) return;
    setSharingTrip(true);
    try {
      // The server mints (or refreshes) the read-only trip token and
      // returns the public link — we hand THAT to the native share sheet
      // rather than a bare "link generated" toast.
      const res = await bookingService.shareTrip(id);
      const url = res.data?.data?.link;
      if (!url) {
        toast.error(errorMessage(undefined, copy.safety.shareTripFailed));
        return;
      }
      Haptics.selectionAsync().catch(() => {});
      await Share.share({
        message: `Track my ErrandGuy trip: ${url}`,
        url,
      });
      // Success is the OS share sheet appearing — no toast needed (a toast
      // would fire even when the user dismisses the sheet). Reflect the
      // now-active share state locally so the "Stop sharing" affordance shows.
      setBooking((prev) =>
        prev && prev.id === id ? { ...prev, trip_share_active: true } : prev,
      );
    } catch (err) {
      toast.error(errorMessage(err, copy.safety.shareTripFailed));
    } finally {
      setSharingTrip(false);
    }
  }, [id, sharingTrip]);

  const handleStopSharing = useCallback(async () => {
    if (!id) return;
    Haptics.selectionAsync().catch(() => {});
    setBooking((prev) =>
      prev && prev.id === id ? { ...prev, trip_share_active: false } : prev,
    );
    try {
      await bookingService.revokeTrip(id);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    } catch {
      // Roll back the optimistic flip and let the user retry.
      setBooking((prev) =>
        prev && prev.id === id ? { ...prev, trip_share_active: true } : prev,
      );
      toast.error('Couldn’t stop sharing your trip. Please try again.');
    }
  }, [id]);

  // no_runner recovery — mirrors book/confirm's exhausted-rebook exactly:
  // re-seed the draft from this booking's fields and drop the user on the
  // review step, where the details that matter for matching (vehicle,
  // timing) are editable.
  const handleRebook = useCallback(() => {
    const b = booking;
    if (!b) {
      router.replace('/(customer)/book/type');
      return;
    }
    clearDraft();
    updateDraft(rebookDraft(b));
    setBookingStep(3);
    setActiveBooking(null);
    router.replace('/(customer)/book/review');
  }, [booking, clearDraft, updateDraft, setBookingStep, setActiveBooking, router]);

  // Active = anything other than terminal states. Used to gate the Android
  // back-button guard so completed/cancelled bookings let the user leave freely.
  // Must run BEFORE any conditional early-return below — hooks rules.
  const isLiveBooking =
    !!booking && !['completed', 'cancelled', 'no_runner'].includes(booking.status);
  useBackGuard(isLiveBooking, 'Tracking your errand — tap back again to leave');

  // Keep the live map lit while the errand is actually running — a customer
  // walking out to meet the runner shouldn't have to keep waking the phone.
  // Releases itself the moment the booking reaches a terminal status.
  useKeepAwakeWhile(isLiveBooking);

  // Speak status changes on iOS. The status pill carries
  // accessibilityLiveRegion, but that is Android-only in React Native — so on
  // iOS a VoiceOver user got no notification when the runner accepted, arrived
  // or handed over: the exact events this screen exists to report. The pill
  // also unmounts on a terminal status, so those were announced nowhere at
  // all. Guarded on a ref because realtime and the poll can deliver the same
  // status twice.
  const announcedStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const status = booking?.status;
    if (!status) return;
    if (announcedStatusRef.current === status) return;
    // Skip the very first render: the user just arrived and the screen reader
    // is already reading the screen.
    const isFirst = announcedStatusRef.current === null;
    announcedStatusRef.current = status;
    if (isFirst || Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(STATUS_LABELS[status] ?? status);
  }, [booking?.status]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <TrackingSkeleton />
      </SafeAreaView>
    );
  }

  if (!booking) {
    // A fetch/network failure gets a retry affordance; only a genuine
    // absence of the errand (a 404) falls through to the "not found"
    // screen — retrying that never succeeds.
    if (loadError && (loadError as { status?: number }).status !== 404) {
      return (
        <SafeAreaView className="flex-1 bg-background" edges={['top']}>
          {/* "Go to Home" is a way out that doesn't depend on Retry working —
              opened from a cold-start push there's no screen behind this one
              to go back to. */}
          <ErrorState
            title="Couldn't load this errand"
            error={loadError}
            onRetry={retryLoad}
            secondaryActionLabel="Go to Home"
            onSecondaryAction={() => router.replace('/(customer)/(tabs)')}
          />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-8">
        <Illustration name="error-not-found" size={180} style={{ marginBottom: 12 }} />
        <Text className="text-lg font-montserrat-semi text-textPrimary">
          Errand not found
        </Text>
        <View className="mt-4">
          <Button title="Go Home" onPress={() => router.replace('/(customer)/(tabs)')} />
        </View>
      </SafeAreaView>
    );
  }

  const errandRule = getErrandTypeRule(booking.errand_type?.slug);
  // Use the per-type flow so single-location errands (queue) don't show
  // dropoff stages they will never reach.
  const steps = errandRule.statusFlow as unknown as BookingStatus[];
  const currentStatusIndex = steps.indexOf(booking.status);
  const isShopping = errandRule.requiresShoppingBudget;
  const isSingleLocation = errandRule.singleLocation;
  const errandSlug = booking.errand_type?.slug;
  // Once a shopping runner has picked up (paid for) the items, the customer
  // can no longer self-cancel — they would still owe the spent amount.
  const canCancel =
    CAN_CANCEL_STATUSES.includes(booking.status) &&
    !(isShopping && !!booking.picked_up_at);

  // The errand is OVER — deliberately narrower than isTerminalUi, which also
  // covers `delivered` (where the post-dropoff safety window is still live and
  // the runner is still reachable, see isLiveBooking above). Past this line
  // there is no runner to call and no trip left to share: the trip-share
  // endpoint excludes completed and cancelled bookings, so Share 404s →
  // "Couldn't share your trip" — every single time.
  const isFinished =
    booking.status === 'completed' ||
    booking.status === 'cancelled' ||
    booking.status === 'no_runner';
  // Cancelled / never-matched errands are a money OUTCOME, not a bill.
  const isMoneyOutcome =
    booking.status === 'cancelled' || booking.status === 'no_runner';
  // What actually happened to the money, straight off the server's derived
  // fields (refunded_amount / refund_destination / cancellation_fee).
  const money = bookingMoneyOutcome(booking);
  const hasReview = !!bookingReview(booking);
  // Cancelled by the server because the GCash/Maya payment never went through.
  const cancelledUnpaid = wasCancelledForUnpaidPayment(booking);
  // A paid errand booked for later sits at `pending` with NO search running
  // until SCHEDULED_MATCH_LEAD_MINUTES before its time — "Finding you a
  // runner, usually under a minute" told the customer a search was live that
  // won't start for hours. Null once its matching window has opened.
  const scheduledFor = awaitingPayment ? null : scheduledWindowLabel(booking);
  // A no-runner errand's money already went back to the wallet (prepaid), so
  // the receipt says so where the customer reads first, not only further down.
  const noRunnerRefund = booking.status === 'no_runner' ? refundedToWallet(booking) : 0;
  // The terse status for the pill: an unpaid booking isn't "Finding a runner",
  // and neither is one scheduled for later.
  const pillLabel = awaitingPayment
    ? AWAITING_PAYMENT_LABEL
    : scheduledFor
      ? 'Scheduled'
      : STATUS_LABELS[booking.status];

  const timelineSteps = steps.map((status, index) => {
    const log = statusLogs.find((l) => l.status === status);
    let stepStatus: 'completed' | 'current' | 'pending' = 'pending';
    if (index < currentStatusIndex) stepStatus = 'completed';
    else if (index === currentStatusIndex) stepStatus = 'current';
    return {
      label: STATUS_LABELS[status],
      timestamp: log ? formatTime(log.created_at) : undefined,
      status: stepStatus,
    };
  });

  // Hero copy — verb-led, role-aware. Mapped per-status so the headline
  // reads as a sentence about what's happening RIGHT NOW from the
  // customer's perspective (e.g. "On the way to you" rather than the
  // backend-flavored "In Transit"). Falls back to STATUS_LABELS for any
  // unmapped status so we never render an empty headline.
  const heroCopy: { title: string; subtitle?: string; accent: 'brand' | 'success' | 'danger' | 'warning' } = (() => {
    const runnerName = booking.runner?.full_name?.split(' ')[0];
    switch (booking.status) {
      case 'pending':
        return awaitingPayment
          ? {
              title: 'Waiting for your payment',
              subtitle: `We'll start finding a runner the moment your payment goes through. ${paymentDeadlineLine(
                booking,
                (ms) => formatTime(new Date(ms)),
              )}`,
              accent: 'warning',
            }
          : scheduledFor
            ? {
                title: 'Scheduled',
                subtitle: `${scheduledFor}. We'll start finding you a runner ${SCHEDULED_MATCH_LEAD_MINUTES} minutes before.`,
                accent: 'brand',
              }
            : { title: 'Finding you a runner', subtitle: 'Usually takes under a minute.', accent: 'warning' };
      case 'no_runner':
        return {
          title: 'No runner available',
          subtitle:
            noRunnerRefund > 0
              ? `Your ${formatCurrency(noRunnerRefund)} went back to your ErrandGuy wallet. Book it again to find a runner.`
              : 'Try again in a few minutes.',
          accent: 'danger',
        };
      // `matched` is a transient state where the system has assigned a
      // runner but the runner hasn't tapped Accept yet. Conflating it
      // with `accepted` lies to the customer ("John accepted" when John
      // hasn't responded). Keep the two visually and verbally distinct.
      case 'matched':
        return {
          title: runnerName ? `${runnerName} was matched` : 'Runner matched',
          subtitle: 'Waiting for them to accept the request.',
          accent: 'warning',
        };
      case 'accepted':
        return {
          title: runnerName ? `${runnerName} accepted` : 'Runner accepted',
          subtitle: 'Getting ready to head out.',
          accent: 'brand',
        };
      case 'heading_to_pickup':
        return { title: 'Heading to pickup', subtitle: runnerName ? `${runnerName} is on the way.` : undefined, accent: 'brand' };
      case 'arrived_at_pickup': {
        // Same status, very different meaning per errand type.
        let subtitle = 'Picking up your order.';
        if (errandSlug === 'queue') subtitle = 'Your runner is now in line.';
        // Any other single-location errand (a legacy bill payment still in
        // progress) is worked on the spot — nothing is being picked up.
        else if (isSingleLocation) subtitle = 'Your runner is on site now.';
        else if (isShopping) subtitle = 'Shopping for your items now.';
        return { title: 'Arrived', subtitle, accent: 'brand' };
      }
      case 'picked_up':
        if (errandSlug === 'queue') return { title: 'At the front', subtitle: 'Your runner reached the front of the line.', accent: 'brand' };
        if (isSingleLocation) return { title: 'Task done', subtitle: 'Your runner is wrapping up.', accent: 'brand' };
        return { title: 'Picked up', subtitle: 'Heading to drop-off next.', accent: 'brand' };
      case 'in_transit':
        return { title: 'On the way to you', accent: 'brand' };
      case 'arrived_at_dropoff':
        return { title: 'Arrived at drop-off', accent: 'brand' };
      case 'delivered':
      case 'completed':
        return {
          title: isSingleLocation ? 'All done' : 'Delivered',
          subtitle: 'Thanks for using ErrandGuy.',
          accent: 'success',
        };
      case 'cancelled':
        // A one-word receipt left the customer to guess what it cost. Lead
        // with the money headline; the card below carries the figures.
        return {
          title: cancelledUnpaid ? UNPAID_CANCEL_TITLE : 'Cancelled',
          subtitle:
            money.refunded != null && money.refunded > 0
              ? 'Your money is already back in your ErrandGuy wallet.'
              : money.fee > 0
                ? 'A cancellation fee was kept from what you paid.'
                : cancelledUnpaid
                  ? unpaidCancelMessage(booking)
                  : 'Nothing was charged for this errand.',
          accent: 'danger',
        };
      default:
        return { title: STATUS_LABELS[booking.status], accent: 'brand' };
    }
  })();

  // ETA pill copy — only meaningful while a runner is moving toward us.
  // Once the trip ends we surface the terminal state in words instead.
  const heroEtaLabel: string | undefined = ['delivered', 'completed', 'cancelled'].includes(booking.status)
    ? booking.status === 'cancelled'
      ? 'Ended'
      : 'Done'
    : booking.status === 'arrived_at_pickup' || booking.status === 'arrived_at_dropoff'
      ? 'Here'
      : undefined;

  const mapCenter: [number, number] = booking.pickup_lng && booking.pickup_lat
    ? [Number(booking.pickup_lng), Number(booking.pickup_lat)]
    : [121.0, 14.6]; // Manila default

  // ── Presentation-only derivations ────────────────────────────────────
  // Accent rungs keyed off heroCopy.accent. Base tones for washes; *Dark
  // rungs for text below ~17px (base tones sit under the 4.5:1 AA floor on
  // white and on their own soft washes).
  const accentText = {
    brand: LightColors.primary,
    success: LightColors.successDark,
    danger: LightColors.dangerDark,
    warning: LightColors.warningDark,
  }[heroCopy.accent];
  const accentBase = {
    brand: LightColors.primary,
    success: LightColors.success,
    danger: LightColors.danger,
    warning: LightColors.warning,
  }[heroCopy.accent];
  const accentDark = {
    brand: LightColors.primaryDark,
    success: LightColors.successDark,
    danger: LightColors.dangerDark,
    warning: LightColors.warningDark,
  }[heroCopy.accent];

  // Same condition as the old hero's showEta — the numeral leads the handle
  // only while a live runner ETA is meaningful.
  const showEtaNumeral = !heroEtaLabel && !!runnerLocation && eta.minutes != null;
  // Clamped to ≥1: pending/matched aren't in errandRule.statusFlow (it
  // starts at 'accepted'), and "STEP 0 OF 6" would read as a bug.
  const stepNumber = Math.min(Math.max(currentStatusIndex + 1, 1), steps.length);
  const eyebrowText = showEtaNumeral
    ? isPickupPhase
      ? 'TO PICKUP'
      : 'TO DROP-OFF'
    : `STEP ${stepNumber} OF ${steps.length}`;

  // Status-pill dot: muted until a runner exists / realtime connects, brand
  // when connected but idle, success while moving. Terminal receipts drop it.
  const pillDotColor = !booking.runner_id
    ? LightColors.textMuted
    : !isConnected
      ? LightColors.textMuted
      : (runnerLocation?.speed ?? 0) > 0
        ? LightColors.success
        : LightColors.primary;

  // Chrome/canvas geometry — computed, not eyeballed. The radar must clear
  // both the chrome row and the half-snap sheet line on an SE (375×667):
  // chromeBottom ≈ 84, sheetTop ≈ 320 → ring ≤ 188 bottoms out at 296 < 320.
  const chromeBottom = insets.top + 8 + 44 + 12;
  const sheetTopAtHalf = winHeight * (1 - SNAP_POINTS.half);
  const pulseSize = Math.max(96, Math.min(200, sheetTopAtHalf - chromeBottom - 48));
  const pulseCenterY = (chromeBottom + sheetTopAtHalf) / 2;
  // Everything floating on the canvas sits just above the peek line — the
  // old bottom:12 pills were occluded by the sheet at every snap.
  const stripBottom = winHeight * SNAP_POINTS.peek + 12;

  // Shared pressed-state for the chrome pills/chips/FABs — scale + opacity,
  // opacity only under Reduce Motion.
  const pressFx = (pressed: boolean) =>
    pressed
      ? reduceMotion
        ? { opacity: 0.7 }
        : { opacity: 0.85, transform: [{ scale: 0.97 }] }
      : null;

  // ── SOS presentation ──────────────────────────────────────────────────
  // trustedCount null (unknown/never-visited) is treated as zero so we never
  // promise contacts we can't confirm — the modal then leads with the honest
  // "no trusted contacts yet" copy and offers the add-a-contact link.
  const hasTrustedContacts = (trustedCount ?? 0) > 0;
  // Elapsed since the server acknowledged it, mm ss / ss. tabular-nums on the
  // readout keeps it from twitching as the digits change.
  const sosElapsedLabel = (() => {
    if (!sosActive || !sosRecord) return null;
    const secs = Math.max(0, Math.floor((sosNow - sosRecord.acknowledgedAt) / 1000));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  })();

  // Receipt tone — glyph + wash per terminal outcome. Shape (Check / X /
  // SearchX) distinguishes the outcomes, not color alone.
  const receiptTone =
    booking.status === 'cancelled'
      ? { bg: LightColors.dangerSoft, fg: LightColors.dangerDark, Icon: X }
      : booking.status === 'no_runner'
        ? { bg: LightColors.warningSoft, fg: LightColors.warningDark, Icon: SearchX }
        : { bg: LightColors.successSoft, fg: LightColors.successDark, Icon: Check };

  // ── Sheet body pieces ─────────────────────────────────────────────────
  // Built once, composed in live or receipt order below, so the handlers
  // (call / chat / share / receipt links) stay single-sourced.

  // ── Runner card ─────────────────────────────────
  // Clean top row (large avatar + name/rating, verified) over a hairline
  // divider, then a labelled action row of icon-chip buttons. The badge is
  // earned (an approved runner only) and the vehicle + plate line is what the
  // customer checks at the door.
  const runnerVerified = isRunnerVerified(booking.runner);
  const runnerVehicle = runnerVehicleLine(booking.runner);
  const runnerCard = booking.runner_id ? (
    <View className="bg-surface rounded-3xl p-4 mb-3" style={Elevation.sm}>
      <View className="flex-row items-center">
        <Avatar
          size="lg"
          uri={booking.runner?.avatar_url ?? undefined}
          name={booking.runner?.full_name}
          isVerified={runnerVerified}
        />
        <View className="flex-1 ml-3.5">
          <Text
            className="text-[16px] font-montserrat-bold text-textPrimary"
            numberOfLines={1}
          >
            {booking.runner?.full_name ?? 'Your runner'}
          </Text>
          {/* A runner with no reviews has avg_rating 0, and printed raw that
              read as "0.0 stars" — the worst-rated operator on the platform —
              to the customer who has just been matched and is deciding whether
              to cancel. formatRating says "New" and draws no stars instead
              (empty stars read as 0/5 just as badly). It also fixes the noun:
              total_ratings is the REVIEW count, not completed errands, so a
              runner with 50 errands and 8 reviews is no longer advertised as
              "8 trips". */}
          {(() => {
            const runnerRating = formatRating(
              booking.runner?.avg_rating,
              booking.runner?.total_ratings,
            );
            return (
              <View
                className="flex-row items-center mt-1"
                accessible
                accessibilityLabel={runnerRating.a11yLabel}
              >
                {!runnerRating.isUnrated && (
                  <RatingStars value={runnerRating.stars} size={13} readonly />
                )}
                <Text
                  className={`text-[11px] font-inter-medium text-textTertiary ${
                    runnerRating.isUnrated ? '' : 'ml-1.5'
                  }`}
                >
                  {runnerRating.label}
                  {runnerRating.countLabel ? ` · ${runnerRating.countLabel}` : ''}
                </Text>
              </View>
            );
          })()}
          {runnerVehicle ? (
            <Text
              className="text-[12px] font-inter-medium text-textSecondary mt-1"
              numberOfLines={1}
              accessibilityLabel={`Vehicle: ${runnerVehicle}`}
              maxFontSizeMultiplier={1.3}
            >
              {runnerVehicle}
            </Text>
          ) : null}
        </View>
        {/* Phase chip is live-only — "In transit" on a finished receipt lies. */}
        {!isTerminalUi && (
          <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: LightColors.surfaceMuted }}>
            <Text
              className="text-[11px] font-montserrat-bold uppercase"
              style={{ color: LightColors.primary700, letterSpacing: 0.8 }}
              maxFontSizeMultiplier={1.3}
            >
              {isPickupPhase ? 'On the way' : 'In transit'}
            </Text>
          </View>
        )}
      </View>

      <View className="h-px bg-divider my-3.5" />

      {/* Action row — evenly spaced icon-chip buttons with labels. On a
          finished errand only Message survives: read-only chat history is
          legitimate (ClosedThreadNotice says so), while Call dials the runner
          of a job that no longer exists and Share is a guaranteed 404. */}
      <View className="flex-row">
        {!isFinished && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Call runner"
            onPress={handleCall}
            className="flex-1 items-center"
            hitSlop={6}
            style={({ pressed }) => pressFx(pressed)}
          >
            <View className="w-11 h-11 rounded-full items-center justify-center mb-1.5" style={{ backgroundColor: LightColors.surfaceMuted }}>
              <Phone size={18} color={LightColors.primary} strokeWidth={2} />
            </View>
            <Text className="text-[11px] font-montserrat-semi text-textSecondary">Call</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unreadForBooking > 0
              ? `Open chat, ${unreadForBooking} unread message${unreadForBooking === 1 ? '' : 's'}`
              : 'Open chat with runner'
          }
          onPress={() => router.push(`/(customer)/chat/${booking.id}`)}
          className="flex-1 items-center"
          hitSlop={6}
          style={({ pressed }) => pressFx(pressed)}
        >
          <View className="w-11 h-11 rounded-full items-center justify-center mb-1.5" style={{ backgroundColor: LightColors.surfaceMuted }}>
            <MessageCircle size={18} color={LightColors.primary} strokeWidth={2} />
            {unreadForBooking > 0 && (
              <View className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-danger rounded-full items-center justify-center border-[1.5px] border-white">
                <Text className="text-[9px] text-white font-montserrat-bold leading-[11px]">
                  {unreadForBooking > 9 ? '9+' : String(unreadForBooking)}
                </Text>
              </View>
            )}
          </View>
          <Text className="text-[11px] font-montserrat-semi text-textSecondary">Message</Text>
        </Pressable>
        {!isFinished && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              booking.trip_share_active
                ? 'Share trip link again'
                : 'Share trip with a contact'
            }
            accessibilityState={{ disabled: sharingTrip }}
            disabled={sharingTrip}
            onPress={handleShareTrip}
            className="flex-1 items-center"
            hitSlop={6}
            style={({ pressed }) => pressFx(pressed)}
          >
            <View className="w-11 h-11 rounded-full items-center justify-center mb-1.5" style={{ backgroundColor: LightColors.surfaceMuted }}>
              <Share2 size={18} color={LightColors.primary} strokeWidth={2} />
            </View>
            <Text className="text-[11px] font-montserrat-semi text-textSecondary">
              {booking.trip_share_active ? 'Shared' : 'Share'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Stop-sharing affordance — only while a read-only trip link
          is live. Revokes the token so the public /trip/{token} page
          goes dark. */}
      {booking.trip_share_active && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop sharing this trip"
          onPress={handleStopSharing}
          hitSlop={{ top: 8, bottom: 8 }}
          className="mt-3 self-center"
          style={({ pressed }) => pressFx(pressed)}
        >
          <Text className="text-[12px] font-montserrat-semi text-dangerDark">
            Stop sharing
          </Text>
        </Pressable>
      )}
    </View>
  ) : null;

  // Trip route — the timeline stays surfaced by default, not behind a toggle.
  const tripRouteSection = (
    <View className="mt-3 mb-2">
      <Text
        className="text-[11px] font-montserrat-bold uppercase text-textSecondary mb-3"
        style={{ letterSpacing: 1.4 }}
        maxFontSizeMultiplier={1.3}
      >
        Trip route
      </Text>
      <StatusTimeline steps={timelineSteps} />
    </View>
  );

  // Item money is cash at the door: the runner pays at the store and the
  // customer repays the receipt amount in person. The exact figure once the
  // runner has bought the items, the budget as a ceiling before that.
  const itemsDue = isShopping ? itemsCashDue(booking) : null;
  // A ₱0 receipt (nothing could be bought) leaves no cash to prepare.
  const cashReadyLine = isShopping && itemsDue !== 0 ? itemsCashReadyLine(booking) : null;
  // Kept above the collapsed trip details while the errand runs, in the same
  // gold cash strip the runner sees for their side of the same handover —
  // finding out at the door that you need ₱1,200 in cash is too late.
  const itemsCashSection =
    !isTerminalUi && cashReadyLine ? (
      <View
        className="mt-3 flex-row items-center rounded-xl px-3 py-2.5 bg-accentSoft border border-accentStrong"
        accessible
        accessibilityLabel={`${cashReadyLine}. Your runner pays at the store; you repay them in cash at the door.`}
      >
        <Banknote size={17} color={LightColors.accentDark} strokeWidth={2} />
        <View className="flex-1 ml-2.5">
          <Text className="text-[13px] font-montserrat-bold text-textPrimary">
            {cashReadyLine}
          </Text>
          <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
            {itemsDue != null
              ? 'Your runner paid at the store — repay them in cash at the door'
              : 'Your runner pays at the store — repay the receipt amount in cash at the door'}
          </Text>
        </View>
      </View>
    ) : null;

  // The fare and how it's paid. Tracking never said either: a cash customer
  // couldn't see how much to hand over, and nobody could tell a paid GCash
  // errand from one still waiting. Cancelled / no-runner errands show their
  // money outcome instead. On a shopping run this is the fare only — the item
  // money is the cash strip.
  const fareLine = farePaymentLine(booking);
  const fareSection = !isMoneyOutcome ? (
    <View
      className="mt-3 flex-row items-center justify-between rounded-xl px-3 py-2.5 bg-surfaceMuted"
      accessible
      accessibilityLabel={`${isShopping ? 'Errand fare, not counting items' : 'Errand fare'}: ${formatCurrency(booking.total_amount)}${fareLine ? `. ${fareLine}` : ''}`}
    >
      <View className="flex-1 pr-3">
        <Text className="text-[13px] font-montserrat-semi text-textPrimary">
          {isShopping ? 'Errand fare' : 'Fare'}
        </Text>
        {fareLine ? (
          <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">{fareLine}</Text>
        ) : null}
      </View>
      <Text className="text-[15px] font-inter-semi text-textPrimary tabular-nums">
        {formatCurrency(booking.total_amount)}
      </Text>
    </View>
  ) : null;

  // Live shopping progress — the runner's ticks, mirrored read-only. Sits
  // OUTSIDE the collapsed "Trip details" disclosure while the errand is
  // running: "has my runner found the milk yet?" is the question the customer
  // otherwise opens the chat to ask, and a collapsed answer is no answer. On a
  // terminal receipt it moves INTO the details section, as a record of what was
  // picked up rather than a live signal.
  const shoppingProgressSection =
    !isTerminalUi && hasShoppingItems ? (
      <View className="mt-3">
        <ShoppingProgressCard items={booking.shopping_items} live />
      </View>
    ) : null;

  // Multi-stop progress — the customer paid a per-stop fee, so "which stops
  // are done?" deserves the same live answer the shopping list gets. Hidden
  // for the ordinary single-drop booking.
  const stopsProgressSection =
    !isTerminalUi && (booking.stops?.length ?? 0) > 0 ? (
      <View className="mt-3">
        <StopsProgressCard stops={booking.stops} live />
      </View>
    ) : null;

  // Extra details (shopping summary + proof photos) — collapsed on live
  // statuses, auto-expanded once on terminal (the receipt IS the point),
  // and only rendered when there's actually something to reveal.
  const detailsSection =
    (isShopping && booking.shopping_budget != null) ||
    (isTerminalUi && hasShoppingItems) ||
    booking.pickup_photo_url ||
    booking.delivery_photo_url ||
    booking.signature_url ? (
      <>
        <Pressable
          onPress={() => setDetailsOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={detailsOpen ? 'Hide trip details' : 'Show trip details'}
          // Row is ~18pt tall — slop lifts the target past the 44pt floor.
          hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
          className="flex-row items-center justify-between mt-3 mb-2"
          style={({ pressed }) => pressFx(pressed)}
        >
          <Text className="text-[11px] font-montserrat-bold uppercase text-textSecondary" style={{ letterSpacing: 1.4 }}>
            {detailsOpen ? 'Hide trip details' : 'Trip details'}
          </Text>
          {detailsOpen ? (
            <ChevronUp size={14} color={LightColors.textTertiary} />
          ) : (
            <ChevronDown size={14} color={LightColors.textTertiary} />
          )}
        </Pressable>
        <View className="h-px bg-divider mb-2" />

        {detailsOpen && (
          <>
            {/* What the runner actually picked up. Live errands render this
                above the fold instead (shoppingProgressSection), so the two
                placements are mutually exclusive. */}
            {isTerminalUi && hasShoppingItems && (
              <View className="mb-4">
                <ShoppingProgressCard items={booking.shopping_items} />
              </View>
            )}
            {/* Shopping summary — the budget the customer set and, once the
                runner has bought the items, the receipt amount. Item money is
                repaid in cash at the door and never charged online, so there
                is no hold, no refund and no top-up to show here. */}
            {isShopping && booking.shopping_budget != null && (
              <View className="bg-primary/5 border border-primary/30 rounded-xl p-4 mb-4">
                <Text className="text-xs font-montserrat-bold text-primary uppercase mb-2">
                  Shopping summary
                </Text>
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text className="text-sm font-montserrat text-textSecondary">
                    Your budget
                  </Text>
                  <Text className="text-sm font-montserrat-bold text-textPrimary">
                    {formatCurrency(booking.shopping_budget)}
                  </Text>
                </View>
                {itemsDue != null && (
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-sm font-montserrat text-textSecondary">
                      Receipt amount
                    </Text>
                    <Text className="text-sm font-montserrat-bold text-textPrimary">
                      {formatCurrency(itemsDue)}
                    </Text>
                  </View>
                )}
                <View className="h-px bg-divider my-2" />
                {/* Through `delivered`: the handover is when the cash changes
                    hands. A finished receipt states the method instead. */}
                {!isFinished && cashReadyLine ? (
                  <>
                    <Text className="text-sm font-montserrat-semi text-textPrimary">
                      {cashReadyLine}
                    </Text>
                    <Text className="text-xs font-montserrat text-textTertiary mt-1">
                      {itemsDue != null
                        ? 'Your runner paid at the store. Repay the receipt amount in cash at the door.'
                        : 'Your runner pays at the store and uploads the receipt. You repay that exact amount in cash at the door.'}
                    </Text>
                  </>
                ) : (
                  <Text className="text-xs font-montserrat text-textTertiary">
                    {itemsDue == null && isMoneyOutcome
                      ? 'No items were bought, so there is nothing to repay.'
                      : 'Items are repaid to your runner in cash at the door — never charged online.'}
                  </Text>
                )}
                {booking.receipt_photo_url && (
                  <Pressable
                    onPress={() => setProofPhotoUri(booking.receipt_photo_url)}
                    className="mt-3 flex-row items-center"
                    style={({ pressed }) => pressFx(pressed)}
                  >
                    <Image
                      source={mediaSource(booking.receipt_photo_url)}
                      className="w-12 h-12 rounded-lg mr-2 bg-divider"
                    />
                    <Text className="text-xs font-montserrat-semi text-primary">
                      View receipt
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Proof photos uploaded by the runner. We only render the card
                when at least one photo exists so it doesn't add visual noise
                for in-progress bookings. Tapping a thumbnail opens the
                full-resolution image in the OS browser. */}
            {(booking.pickup_photo_url || booking.delivery_photo_url || booking.signature_url) && (
              <View
                className="mt-4 bg-white rounded-xl p-4"
                // Hairline so the card reads as a card on the white sheet —
                // without it this section is an invisible white-on-white block,
                // out of step with the runner (Elevation.sm) and shopping
                // (bordered) cards above it.
                style={{ borderWidth: 1, borderColor: LightColors.divider }}
              >
                <Text className="text-sm font-montserrat-bold text-textPrimary mb-3">
                  Proof photos
                </Text>
                <View className="flex-row gap-3">
                  {booking.pickup_photo_url && (() => {
                    const uri = resolveImageUrl(booking.pickup_photo_url);
                    if (!uri) return null;
                    return (
                      <Pressable
                        className="flex-1"
                        onPress={() => setProofPhotoUri(uri)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel="Open pickup proof photo"
                      >
                        <ExpoImage
                          source={mediaSource(uri)}
                          style={{ width: '100%', height: 120, borderRadius: 16, backgroundColor: LightColors.divider }}
                          contentFit="cover"
                          transition={150}
                          cachePolicy="memory-disk"
                        />
                        <Text className="text-[11px] font-montserrat-semi text-textSecondary mt-1.5">
                          Pickup
                        </Text>
                      </Pressable>
                    );
                  })()}
                  {booking.delivery_photo_url && (() => {
                    const uri = resolveImageUrl(booking.delivery_photo_url);
                    if (!uri) return null;
                    return (
                      <Pressable
                        className="flex-1"
                        onPress={() => setProofPhotoUri(uri)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel="Open delivery proof photo"
                      >
                        <ExpoImage
                          source={mediaSource(uri)}
                          style={{ width: '100%', height: 120, borderRadius: 16, backgroundColor: LightColors.divider }}
                          contentFit="cover"
                          transition={150}
                          cachePolicy="memory-disk"
                        />
                        <Text className="text-[11px] font-montserrat-semi text-textSecondary mt-1.5">
                          Delivery
                        </Text>
                      </Pressable>
                    );
                  })()}
                  {booking.signature_url && (() => {
                    // Signature is stored as a PNG in the same delivery-proofs
                    // bucket as the pickup/delivery photos. We render it on a
                    // white background (contentFit "contain") so the dark ink
                    // strokes stay legible — "cover" would crop most signatures.
                    const uri = resolveImageUrl(booking.signature_url);
                    if (!uri) return null;
                    return (
                      <Pressable
                        className="flex-1"
                        onPress={() => setProofPhotoUri(uri)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel="Open customer signature"
                      >
                        <ExpoImage
                          source={mediaSource(uri)}
                          style={{ width: '100%', height: 120, borderRadius: 16, backgroundColor: LightColors.surface, borderWidth: 1, borderColor: LightColors.divider }}
                          contentFit="contain"
                          transition={150}
                          cachePolicy="memory-disk"
                        />
                        <Text className="text-[11px] font-montserrat-semi text-textSecondary mt-1.5">
                          Signature
                        </Text>
                      </Pressable>
                    );
                  })()}
                </View>
                {/* Handed over without a signature: the runner's reason is the
                    completion's status-log note ("No signature: …"). */}
                {!booking.signature_url && (() => {
                  const note = statusLogs.find((l) => l.status === 'completed')?.note;
                  if (!note?.startsWith('No signature: ')) return null;
                  return (
                    <Text className="text-[12px] font-montserrat text-textSecondary mt-3">
                      {`No signature · ${note.slice('No signature: '.length)}`}
                    </Text>
                  );
                })()}
              </View>
            )}
          </>
        )}
      </>
    ) : null;

  // Cancel-window-closed notice. Shopping errands have always explained
  // themselves here ("the runner already paid for the items"); every other
  // errand type got NOTHING — past heading_to_pickup the Cancel button simply
  // vanished from the footer, so a customer who wanted out at
  // arrived_at_pickup hunted for a button that was there a minute ago. Same
  // understated treatment, generalised, and tappable through to the support
  // path that can still help them.
  const cancelClosedNotice =
    !isTerminalUi && !canCancel ? (
      <Pressable
        onPress={() => handleReportProblem('booking')}
        accessibilityRole="button"
        accessibilityLabel="Cancel is closed — report a problem with this errand"
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        className="bg-warning/10 border border-warning/40 rounded-xl p-3 mt-4 mb-2"
        style={({ pressed }) => pressFx(pressed)}
      >
        <Text className="text-xs font-montserrat-semi text-warningDark text-center">
          {isShopping && booking.picked_up_at
            ? 'Your runner already paid for the items, so cancel is no longer available. Tap to report a problem and we’ll help.'
            : 'Your runner has already started this errand, so self-cancel is closed. Tap to report a problem and we’ll help.'}
        </Text>
      </Pressable>
    ) : null;

  // ── What the errand actually cost ─────────────────────────────────────
  // The server records a fee, refunds the remainder to the wallet and flips
  // payment_status to 'refunded' — and until now not one of those facts
  // survived the cancel toast. The receipt was the single word "Cancelled"
  // and the Activity sheet still billed the full fare, so the only trace of
  // the customer's ₱480 was a wallet ledger row on another screen.
  //
  // Every figure comes from the server (BookingResource's cancellation_fee /
  // refunded_amount / refund_destination). Nothing is recomputed here: the
  // recorded fee is capped and zeroed by settlement (PRICE-3 / PRICE-4), so a
  // client-side "total − policy fee" would print a phantom charge.
  const moneyOutcomeSection = isMoneyOutcome ? (
    <View className="bg-surfaceMuted rounded-2xl p-4 mt-1">
      <Text
        className="text-[11px] font-montserrat-bold uppercase text-textSecondary mb-3"
        style={{ letterSpacing: 1.4 }}
        maxFontSizeMultiplier={1.3}
      >
        What it cost
      </Text>
      {money.moneyMoved ? (
        <>
          <View className="flex-row items-center justify-between mb-1.5">
            <Text className="text-[13px] font-montserrat text-textSecondary">
              Errand total
            </Text>
            <Text className="text-[13px] font-inter text-textSecondary tabular-nums">
              {formatCurrency(booking.total_amount)}
            </Text>
          </View>
          {money.fee > 0 ? (
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="text-[13px] font-montserrat text-textSecondary">
                Cancellation fee
              </Text>
              <Text
                className="text-[13px] font-inter tabular-nums"
                style={{ color: LightColors.dangerDark }}
              >
                −{formatCurrency(money.fee)}
              </Text>
            </View>
          ) : null}
          <View className="h-px bg-divider my-2" />
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] font-montserrat-semi text-textPrimary flex-1 pr-3">
              {money.destination === 'wallet'
                ? 'Refunded to your ErrandGuy wallet'
                : 'Refunded'}
            </Text>
            <Text
              className="text-[15px] font-inter-semi tabular-nums"
              style={{
                color:
                  money.refunded != null && money.refunded > 0
                    ? LightColors.successDark
                    : LightColors.textSecondary,
              }}
            >
              {formatCurrency(money.refunded ?? 0)}
            </Text>
          </View>
        </>
      ) : (
        <Text className="text-[13px] font-montserrat text-textSecondary">
          Nothing was charged for this errand.
        </Text>
      )}
      {booking.cancellation_reason ? (
        <Text className="text-[12px] font-montserrat text-textTertiary mt-3">
          Reason: {booking.cancellation_reason}
        </Text>
      ) : null}
    </View>
  ) : null;

  // Quiet report-a-problem link — routes to the support composer pre-seeded
  // with this booking. Safety category while an SOS is live, otherwise a plain
  // booking issue. Deliberately understated (textSecondary, no card) so it
  // never competes with the primary flow.
  const reportProblemLink = (
    <View className="flex-row flex-wrap items-center justify-center mt-4 mb-1" style={{ columnGap: 20, rowGap: 8 }}>
      <Pressable
        onPress={() => handleReportProblem(sosActive ? 'safety' : 'booking')}
        accessibilityRole="button"
        accessibilityLabel="Report a problem with this errand"
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        className="flex-row items-center"
        style={({ pressed }) => pressFx(pressed)}
      >
        <Flag size={13} color={LightColors.textTertiary} strokeWidth={2} />
        <Text className="ml-1.5 text-[12px] font-montserrat-semi text-textSecondary">
          Report a problem
        </Text>
      </Pressable>
      {booking.runner_id ? (
        <Pressable
          onPress={() => {
            haptics.selection();
            setShowReportUser(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Report this person — your runner"
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          className="flex-row items-center"
          style={({ pressed }) => pressFx(pressed)}
        >
          <UserX size={13} color={LightColors.textTertiary} strokeWidth={2} />
          <Text className="ml-1.5 text-[12px] font-montserrat-semi text-textSecondary">
            Report this person
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: LightColors.background }}>
      {/* ── Canvas — brand gradient + radar (pre-dispatch), live map
          (en-route, phase-gated), or a calm receipt wash (terminal).
          Chosen purely from booking.status + mapMounted so deep-link cold
          starts land in the right mode with no flash of a wrong one. */}
      <View style={StyleSheet.absoluteFill}>
        {isTerminalUi ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: LightColors.background }]}>
            {/* The blue dies with the trip — delivered/completed get a calm
                brand wash at the top; cancelled/no_runner stay plain. */}
            {(booking.status === 'delivered' || booking.status === 'completed') && (
              <LinearGradient
                colors={[LightColors.primary50, LightColors.background]}
                style={{ height: 160 }}
              />
            )}
          </View>
        ) : (
          <>
            {mapMounted && (
              <HereMapView
                ref={mapRef}
                style={{ flex: 1 }}
                showsMyLocationButton={false}
                showsCompass={false}
                maxZoomLevel={17}
                onMapReady={dismissVeil}
                initialRegion={{
                  latitude: mapCenter[1],
                  longitude: mapCenter[0],
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }}
              >
                {/* Pickup marker — brand dot. Equal w/h + center anchor so
                    HereMarker's anchor math holds; the dropoff differs by
                    SHAPE (rounded-square), not color alone. */}
                {booking.pickup_lng && booking.pickup_lat && (
                  <HereMarker
                    coordinate={{ latitude: Number(booking.pickup_lat), longitude: Number(booking.pickup_lng) }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    id="pickup-marker"
                  >
                    <View style={styles.pickupPin} />
                  </HereMarker>
                )}

                {/* Dropoff marker — ink rounded-square. */}
                {booking.dropoff_lng && booking.dropoff_lat && (
                  <HereMarker
                    coordinate={{ latitude: Number(booking.dropoff_lat), longitude: Number(booking.dropoff_lng) }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    id="dropoff-marker"
                  >
                    <View style={styles.dropoffPin} />
                  </HereMarker>
                )}

                {/* Runner marker (moving) */}
                {runnerLocation && (
                  <HereMarker
                    coordinate={{ latitude: Number(runnerLocation.lat), longitude: Number(runnerLocation.lng) }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    id="runner-marker"
                  >
                    <View style={styles.runnerMarkerWrap}>
                      <View style={styles.runnerMarkerOuter}>
                        {runnerLocation.speed != null && runnerLocation.speed > 0 && (
                          reduceMotion ? (
                            <View
                              pointerEvents="none"
                              style={[styles.runnerPulse, { opacity: 0.25 }]}
                            />
                          ) : (
                            <Animated.View
                              pointerEvents="none"
                              style={[
                                styles.runnerPulse,
                                {
                                  opacity: runnerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                                  transform: [
                                    {
                                      scale: runnerPulse.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0.6, 2.4],
                                      }),
                                    },
                                  ],
                                },
                              ]}
                            />
                          )
                        )}
                        <View style={styles.runnerMarkerInner}>
                          <Bike size={16} color={LightColors.textInverse} strokeWidth={2.4} />
                        </View>
                      </View>
                      {runnerLocation.speed != null && runnerLocation.speed > 0 && (
                        <View style={styles.runnerSpeedBadge}>
                          <Text style={styles.runnerSpeedText}>
                            {(runnerLocation.speed * 3.6).toFixed(0)} km/h
                          </Text>
                        </View>
                      )}
                    </View>
                  </HereMarker>
                )}

                {/* Route line */}
                {routeMapCoords.length > 0 && (
                  <>
                    <HerePolyline id="route-outline" coordinates={routeMapCoords} strokeColor={LightColors.primary900} strokeWidth={8} lineJoin="round" />
                    <HerePolyline id="route-fill" coordinates={routeMapCoords} strokeColor={LightColors.primary500} strokeWidth={5} lineJoin="round" />
                  </>
                )}
              </HereMapView>
            )}

            {/* Gradient veil — stays above the map until the first tiles are
                in (onMapReady / 1.5s timeout), so MapLibre's grey
                checkerboard is never visible. The `!prevMapMountedRef` arm
                covers the map's very first frame, where the mount effect
                hasn't flipped veilVisible yet (effects run post-paint). */}
            {mapMounted && (veilVisible || !prevMapMountedRef.current) && (
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { opacity: veilOpacity }]}
              >
                <LinearGradient
                  colors={[
                    LightColors.gradientStart,
                    LightColors.gradientMid,
                    LightColors.gradientEnd,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            )}

            {!mapMounted && (
              <>
                <LinearGradient
                  colors={[
                    LightColors.gradientStart,
                    LightColors.gradientMid,
                    LightColors.gradientEnd,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                {/* Radar — spatial continuity from book/confirm's search
                    radar, centered in the free band between the chrome and
                    the half-snap sheet line so the rings never clip. */}
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: pulseCenterY - pulseSize / 2,
                    height: pulseSize,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {reduceMotion ? (
                    <View
                      style={[
                        styles.staticRing,
                        { width: pulseSize, height: pulseSize, borderRadius: pulseSize / 2 },
                      ]}
                    />
                  ) : (
                    <>
                      <PulseRing delay={0} size={pulseSize} />
                      <PulseRing delay={700} size={pulseSize} />
                    </>
                  )}
                  <View style={styles.radarCenter}>
                    <Bike size={28} color={RING_COLOR} strokeWidth={2.2} />
                  </View>
                </View>
                {/* Map opt-in — label kept verbatim for a11y parity. */}
                <View
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: stripBottom,
                    alignItems: 'center',
                  }}
                >
                  <Pressable
                    onPress={() => setMapOverride('on')}
                    accessibilityRole="button"
                    accessibilityLabel="View live map"
                    style={({ pressed }) => [
                      styles.chromeSurface,
                      {
                        minHeight: 44,
                        borderRadius: 999,
                        paddingHorizontal: 20,
                        flexDirection: 'row',
                        alignItems: 'center',
                      },
                      pressFx(pressed),
                    ]}
                  >
                    <MapPin size={16} color={LightColors.primary} strokeWidth={2.2} />
                    <Text
                      className="ml-2 text-[13px] font-montserrat-bold text-textPrimary"
                      maxFontSizeMultiplier={1.3}
                    >
                      View live map
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            {mapMounted && (
              <>
                {/* Bottom strip — sits above the peek line so it's never
                    occluded by the sheet. Hide-map left, live pill right,
                    route-retry chip fills the middle when needed. */}
                <View
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute',
                    left: 16,
                    right: 16,
                    bottom: stripBottom,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Pressable
                    onPress={() => setMapOverride('off')}
                    accessibilityRole="button"
                    accessibilityLabel="Hide map"
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.chromeSurface,
                      {
                        minHeight: 36,
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                      },
                      pressFx(pressed),
                    ]}
                  >
                    <X size={14} color={LightColors.textPrimary} strokeWidth={2.4} />
                    <Text
                      className="ml-1 text-[12px] font-montserrat-bold text-textPrimary"
                      maxFontSizeMultiplier={1.3}
                    >
                      Hide map
                    </Text>
                  </Pressable>
                  {/* Route load failure — surfaces the error that used to be
                      silently swallowed; one-tap retry bypasses the cache. */}
                  {routeFetchState === 'error' ? (
                    <View
                      className="flex-1 flex-row items-center bg-surface border border-divider rounded-full px-3 py-2"
                      style={Elevation.md}
                    >
                      <View className="w-2 h-2 rounded-full mr-1.5 bg-warning" />
                      <Text
                        className="flex-1 text-[12px] font-montserrat text-textSecondary"
                        numberOfLines={1}
                      >
                        Couldn&apos;t load route
                      </Text>
                      <Pressable
                        onPress={retryRoute}
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading route"
                        hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                        className="ml-2"
                        style={({ pressed }) => pressFx(pressed)}
                      >
                        <Text className="text-[12px] font-montserrat-bold text-primary">
                          Retry
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View className="flex-1" pointerEvents="none" />
                  )}
                  {/* Realtime indicator — three states: Connecting (no
                      channel yet), Live + idle, Live + moving (with the
                      km/h reading so motion is visible at a glance). */}
                  {booking.runner_id && (
                    <View
                      className="flex-row items-center bg-surface border border-divider rounded-full pl-2 pr-3 py-1.5"
                      accessible
                      accessibilityLabel={
                        !isConnected
                          ? 'Connecting to live tracking'
                          : runnerLocation?.speed != null && runnerLocation.speed > 0
                            ? `Runner live, moving at ${Math.round(runnerLocation.speed * 3.6)} kilometres per hour`
                            : 'Runner live'
                      }
                      style={Elevation.md}
                    >
                      <View className="items-center justify-center mr-1.5" style={{ width: 10, height: 10 }}>
                        <View className={`w-2 h-2 rounded-full ${
                          isConnected
                            ? runnerLocation?.speed != null && runnerLocation.speed > 0
                              ? 'bg-success'
                              : 'bg-primary'
                            : 'bg-textMuted'
                        }`} />
                        {isConnected && runnerLocation?.speed != null && runnerLocation.speed > 0 && (
                          reduceMotion ? (
                            <View
                              pointerEvents="none"
                              style={{
                                position: 'absolute',
                                width: 10,
                                height: 10,
                                borderRadius: 5,
                                backgroundColor: LightColors.success,
                                opacity: 0.25,
                              }}
                            />
                          ) : (
                            <Animated.View
                              pointerEvents="none"
                              style={{
                                position: 'absolute',
                                width: 10,
                                height: 10,
                                borderRadius: 5,
                                backgroundColor: LightColors.success,
                                opacity: runnerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                                transform: [{ scale: runnerPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
                              }}
                            />
                          )
                        )}
                      </View>
                      <Text className="text-[11px] font-montserrat-bold text-textPrimary">
                        {!isConnected
                          ? 'Connecting…'
                          : runnerLocation?.speed != null && runnerLocation.speed > 0
                          ? `${Math.round(runnerLocation.speed * 3.6)} km/h · moving`
                          : 'Live'}
                      </Text>
                    </View>
                  )}
                </View>
                {/* Recenter — re-runs the same fit the auto-fit effect uses. */}
                <Pressable
                  onPress={handleRecenter}
                  accessibilityRole="button"
                  accessibilityLabel="Recenter map"
                  style={({ pressed }) => [
                    styles.chromeSurface,
                    {
                      position: 'absolute',
                      right: 16,
                      bottom: stripBottom + 52,
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    pressFx(pressed),
                  ]}
                >
                  <Crosshair size={20} color={LightColors.textPrimary} strokeWidth={2} />
                </Pressable>
              </>
            )}
          </>
        )}
      </View>

      {/* ── Floating chrome — back circle + centered status pill on
          near-opaque white surfaces (no expo-blur; opacity + hairline +
          Elevation.md stand in for a real frost). box-none everywhere so
          the map stays pannable between the pills. */}
      <SafeAreaView
        edges={['top']}
        pointerEvents="box-none"
        // Must float ABOVE the sheet (zIndex 999) and its footer (zIndex 1000):
        // at the full snap the sheet top rides up to ~height*0.08 and would
        // otherwise swallow the back button + status pill — and full is the
        // default snap for terminal receipts, where the back button is the
        // only way off the screen. elevation clears the Android z-order too
        // (sheet 24 / footer 28 use elevation, not zIndex, on Android).
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1001, elevation: 32 }}
      >
        <View className="px-4 pt-4 flex-row items-center" pointerEvents="box-none">
          <Reanimated.View entering={reduceMotion ? FadeIn.duration(120) : chromeEnter(0)}>
            <Pressable
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(customer)/(tabs)')}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              style={({ pressed }) => [
                styles.chromeSurface,
                { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
                pressFx(pressed),
              ]}
            >
              <ArrowLeft size={22} color={LightColors.textPrimary} strokeWidth={2.2} />
            </Pressable>
          </Reanimated.View>
          {/* 44pt back circle + 44pt spacer keep the pill optically centered. */}
          <View className="flex-1 items-center px-2" pointerEvents="box-none">
            {/* Live tracking: the status pill floats over the map. Terminal:
                hidden — the sheet's own hero (illustration + status) carries it,
                so the pill no longer stacks on top of the collapsed handle. */}
            {!isTerminalUi && (
            <Reanimated.View
              entering={reduceMotion ? FadeIn.duration(120) : chromeEnter(40)}
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${pillLabel}${
                booking.runner_id && !isTerminalUi
                  ? isConnected
                    ? ', live tracking connected'
                    : ', reconnecting to live tracking'
                  : ''
              }`}
              style={[
                styles.chromeSurface,
                {
                  maxWidth: winWidth - 144,
                  minHeight: 36,
                  borderRadius: 18,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                },
              ]}
            >
              {!isTerminalUi && (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginRight: 8,
                    backgroundColor: pillDotColor,
                  }}
                />
              )}
              <Reanimated.View
                key={booking.status}
                entering={reduceMotion ? undefined : FadeIn.duration(150)}
                exiting={reduceMotion ? undefined : FadeOut.duration(150)}
                style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}
              >
                <Text
                  className="text-[13px] font-montserrat-bold text-textPrimary"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {pillLabel}
                </Text>
                {/* Degraded realtime is surfaced as TEXT, never color-only. */}
                {booking.runner_id && !isConnected && !isTerminalUi ? (
                  <Text
                    className="text-[11px] font-montserrat-semi text-textTertiary"
                    maxFontSizeMultiplier={1.3}
                  >
                    {' '}· Connecting…
                  </Text>
                ) : null}
              </Reanimated.View>
            </Reanimated.View>
            )}
          </View>
          <View style={{ width: 44 }} />
        </View>
      </SafeAreaView>

      {/* ── Sheet — ETA-led handle over the scrollable body. snapPoints are
          CONSTANT; only `initial` flips (once, into a terminal status) so
          the sheet never re-snaps under the user mid-trip. */}
      <ExpandableSheet
        snapPoints={SNAP_POINTS}
        initial={isTerminalUi ? 'full' : 'half'}
        reduceMotion={reduceMotion}
        renderHandle={() =>
          isTerminalUi ? (
            /* Terminal receipt: the scrollable body hero (illustration +
               status + trip route) tells the whole story, so the handle
               collapses to a slim premium journey-summary strip. Removes the
               old triple-status stack (chrome pill + eyebrow + title) and the
               overlap with the floating back chrome. no_runner has no journey
               to summarise, so it collapses to a bare grab area. */
            <View className="px-5 pt-2 pb-2">
              {booking.status !== 'no_runner' && (
                <JourneyBeads
                  status={booking.status}
                  accent={booking.status === 'cancelled' ? 'danger' : 'success'}
                  showLabel={false}
                />
              )}
            </View>
          ) : (
          <View
            className="px-5 pt-1 pb-1"
            accessible
            accessibilityLabel={`Step ${Math.min(currentStatusIndex + 1, steps.length)} of ${steps.length}${
              /* Spoken ETA gated identically to the visual numeral — on
                 arrived and terminal statuses the pill shows Here/Done/Ended,
                 so a stale minute count must never be announced over it. */
              showEtaNumeral
                ? `, arriving in about ${eta.minutes} minute${eta.minutes === 1 ? '' : 's'}`
                : heroEtaLabel
                  ? `, ${heroEtaLabel === 'Here' ? 'runner is here' : heroEtaLabel.toLowerCase()}`
                  : ''
            }`}
          >
            <View className="flex-row items-center">
              <View className="flex-1 pr-3">
                <Text
                  className="text-[11px] font-montserrat-bold uppercase"
                  style={{ color: accentText, letterSpacing: 1.2 }}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {eyebrowText}
                </Text>
                {showEtaNumeral ? (
                  <View className="flex-row" style={{ alignItems: 'baseline', minHeight: 40 }}>
                    <Reanimated.Text
                      key={reduceMotion ? 'eta-static' : `eta-${eta.minutes}`}
                      entering={reduceMotion ? undefined : DigitEnter}
                      exiting={reduceMotion ? undefined : DigitExit}
                      style={styles.etaNumeral}
                      maxFontSizeMultiplier={1.2}
                    >
                      {eta.minutes}
                    </Reanimated.Text>
                    <Text
                      className="text-[17px] font-montserrat-semi text-textSecondary"
                      maxFontSizeMultiplier={1.2}
                    >
                      {' '}min
                    </Text>
                  </View>
                ) : (
                  <Text
                    className="text-[22px] font-montserrat-bold text-textPrimary"
                    style={{ lineHeight: 26 }}
                    numberOfLines={2}
                    maxFontSizeMultiplier={1.2}
                  >
                    {heroCopy.title}
                  </Text>
                )}
              </View>
              {(heroEtaLabel || booking.runner_id) ? (
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  {heroEtaLabel && (
                    <View
                      className="rounded-full px-3.5 py-1.5"
                      style={{ backgroundColor: `${accentBase}1A` }}
                    >
                      <Text
                        className="text-[12px] font-montserrat-bold"
                        style={{ color: accentDark }}
                        maxFontSizeMultiplier={1.3}
                      >
                        {heroEtaLabel}
                      </Text>
                    </View>
                  )}
                  {booking.runner_id ? (
                    <View className="items-center" style={{ maxWidth: 72 }}>
                      <Avatar
                        size="md"
                        uri={booking.runner?.avatar_url ?? undefined}
                        name={booking.runner?.full_name}
                        isVerified={runnerVerified}
                      />
                      <Text
                        className="text-[12px] font-montserrat-semi text-textSecondary mt-0.5"
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                      >
                        {booking.runner?.full_name?.split(' ')[0] ?? 'Runner'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
            {/* pt-2 (not pt-3): buys back the ~4pt that keeps the whole handle
                block inside the 0.24 peek band on a 360x640 Android at font
                scale 1.3 with a two-line headline (e.g. "Arrived at drop-off"),
                so the live micro-row below never clips under the peek fold. */}
            <View className="pt-2">
              <JourneyBeads
                status={booking.status}
                accent={booking.status === 'cancelled' ? 'danger' : 'brand'}
                showLabel={false}
              />
            </View>
            {booking.runner_id && !isTerminalUi ? (
              <View className="flex-row items-center justify-end -mt-1 mb-1">
                <View className={`w-1.5 h-1.5 rounded-full mr-1 ${isConnected ? 'bg-success' : 'bg-textMuted'}`} />
                <Text
                  className="text-[11px] font-montserrat text-textTertiary uppercase"
                  style={{ letterSpacing: 1 }}
                  maxFontSizeMultiplier={1.3}
                >
                  {isConnected ? 'Live' : 'Reconnecting'}
                </Text>
              </View>
            ) : null}
          </View>
          )
        }
        footer={
          // SOS is available on ANY live errand. It stays through 'delivered'
          // (post-dropoff safety window) and only drops on
          // completed/cancelled/no_runner — isLiveBooking is exactly that set.
          // Terminal receipts with nothing to show render no footer at all.
          isLiveBooking || sosActive || sosResolved || !!queuedSos || canCancel ? (
            <View style={{ gap: 8 }}>
              {/* The one thing an unpaid GCash/Maya booking is waiting on —
                  reopens the same checkout, so it can never charge twice. */}
              {awaitingPayment && checkoutUrl ? (
                <Button
                  title="Complete payment"
                  onPress={completePayment}
                  loading={openingCheckout}
                  loadingTitle="Opening checkout…"
                  fullWidth
                />
              ) : null}
              {!sosActive && !queuedSos && isLiveBooking && (
                <Button
                  title="Emergency SOS"
                  variant="danger"
                  icon={Shield}
                  onPress={handleSOS}
                  fullWidth
                />
              )}
              {/* Queued-but-unsent SOS. It must never look like "SOS active":
                  nobody has been alerted yet. One tap reopens the fallback
                  sheet (911 + tap-to-call contacts + manual retry). */}
              {!sosActive && !!queuedSos && (
                <Pressable
                  onPress={() => {
                    haptics.selection();
                    setShowSosPending(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="SOS not sent yet — open emergency options"
                  className="flex-row items-center rounded-2xl border border-danger bg-dangerSoft px-4 py-3.5"
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                >
                  <Shield size={18} color={LightColors.dangerDark} strokeWidth={2.4} />
                  <View className="flex-1 ml-2.5">
                    <Text
                      className="text-[14px] font-montserrat-bold text-dangerDark"
                      maxFontSizeMultiplier={1.3}
                    >
                      SOS not sent yet
                    </Text>
                    <Text
                      className="text-[12px] font-montserrat text-dangerDark mt-0.5"
                      maxFontSizeMultiplier={1.3}
                    >
                      {sosSending
                        ? 'Sending…'
                        : 'We’ll keep trying — tap for call options'}
                    </Text>
                  </View>
                </Pressable>
              )}
              {sosActive && sosRecord && (
                <SosActiveCard
                  record={sosRecord}
                  elapsedLabel={sosElapsedLabel}
                  contacts={trustedContacts ?? []}
                  onStandDown={handleStandDown}
                  standingDown={deactivatingSOS}
                  standDownResetKey={standDownResetKey}
                />
              )}
              {/* Closed by someone else (staff, or no longer open on the
                  server). Said plainly, with when — and the SOS button above
                  stays available for a new alert. */}
              {sosResolved && sosRecord && (
                <SosResolvedNotice
                  record={sosRecord}
                  onDismiss={() => {
                    if (id) clearSosActive(id);
                  }}
                />
              )}
              {canCancel && (
                <Button
                  title="Cancel errand"
                  loading={isCancelling}
                  loadingTitle="Cancelling…"
                  variant="outline"
                  onPress={handleCancel}
                  disabled={isCancelling}
                  fullWidth
                />
              )}
            </View>
          ) : null
        }
      >
        <ScrollView
          className="flex-1 px-5 pt-2"
          showsVerticalScrollIndicator={false}
          // +insets.bottom so the terminal receipt (no footer → the sheet's
          // content wrapper reserves 0) clears the home indicator; live
          // statuses already reserve the measured footer height on top of this.
          contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
        >
          {/* Booking number leads the body — support triages from customer
              screenshots of the sheet, so it must be readable at the half
              snap without scrolling. */}
          <Text
            className={`text-[12px] font-inter text-textTertiary mb-2${isTerminalUi ? ' text-center' : ''}`}
            style={{ letterSpacing: 0.5 }}
            maxFontSizeMultiplier={1.3}
          >
            {booking.booking_number}
          </Text>

          {isTerminalUi ? (
            /* Receipt layout — delivered and completed render identically so
               the one frame before the completed→rate replace is coherent. */
            <>
              <View className="items-center mt-2 mb-6">
                {/* The two recoverable/terminal error outcomes lead with a
                    generated illustration instead of the small tone glyph —
                    delivered/completed keep the compact circle. */}
                {booking.status === 'no_runner' || booking.status === 'cancelled' ? (
                  <Illustration
                    name={booking.status === 'cancelled' ? 'booking-cancelled' : 'error-no-runner'}
                    size={150}
                    style={{ marginBottom: 4 }}
                  />
                ) : (
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      backgroundColor: receiptTone.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <receiptTone.Icon size={28} color={receiptTone.fg} strokeWidth={2.2} />
                  </View>
                )}
                <Text
                  className="text-[26px] font-montserrat-bold text-textPrimary text-center mt-3"
                  maxFontSizeMultiplier={1.2}
                >
                  {heroCopy.title}
                </Text>
                {heroCopy.subtitle ? (
                  <Text className="text-[13px] font-montserrat text-textSecondary text-center mt-1">
                    {heroCopy.subtitle}
                  </Text>
                ) : null}
                {booking.status === 'no_runner' && (
                  <View className="mt-4 w-full">
                    <Button title="Book again" onPress={handleRebook} fullWidth />
                  </View>
                )}
                {/* Never paid, so never started: booking it again IS the way
                    forward, so it leads (primary), like no_runner's. */}
                {cancelledUnpaid && (
                  <View className="mt-4 w-full">
                    <Button
                      title="Book again"
                      onPress={handleRebook}
                      accessibilityHint="Starts a new errand pre-filled from this one"
                      fullWidth
                    />
                  </View>
                )}
                {/* A cancelled errand's only remaining action used to be
                    "Report a problem" — even though the errand still needs
                    doing. Recovery variant (secondary), matching the Activity
                    sheet's own cancelled rebook. */}
                {booking.status === 'cancelled' && !cancelledUnpaid && (
                  <View className="mt-4 w-full">
                    <Button
                      title="Rebook this errand"
                      variant="secondary"
                      onPress={handleRebook}
                      accessibilityHint="Starts a new errand pre-filled from this one"
                      fullWidth
                    />
                  </View>
                )}
                {/* Rate stays reachable ON PURPOSE now that a completed
                    errand no longer force-replaces to the rating screen. */}
                {booking.status === 'completed' && !hasReview && (
                  <View className="mt-4 w-full">
                    <Button
                      title="Rate your runner"
                      onPress={() => router.push(`/(customer)/rate/${booking.id}`)}
                      fullWidth
                    />
                  </View>
                )}
              </View>
              {moneyOutcomeSection}
              {fareSection}
              {tripRouteSection}
              {detailsSection}
              {runnerCard ? <View className="mt-3">{runnerCard}</View> : null}
              {reportProblemLink}
            </>
          ) : (
            <>
              {(showEtaNumeral || heroCopy.subtitle) ? (
                <View className="mb-4">
                  {/* When the numeral owns the handle, the status verb moves
                      down here as a lead-in — no copy is ever lost. */}
                  {showEtaNumeral ? (
                    <Text className="text-[13px] font-montserrat-semi text-textSecondary">
                      {heroCopy.title}
                    </Text>
                  ) : null}
                  {heroCopy.subtitle ? (
                    <Text className={`text-[13px] font-montserrat text-textSecondary${showEtaNumeral ? ' mt-0.5' : ''}`}>
                      {heroCopy.subtitle}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {runnerCard}
              {fareSection}
              {itemsCashSection}
              {shoppingProgressSection}
              {stopsProgressSection}
              {tripRouteSection}
              {detailsSection}
              {cancelClosedNotice}
              {reportProblemLink}
            </>
          )}
        </ScrollView>
      </ExpandableSheet>

      {/* Verifies a reopened GCash/Maya checkout ("Complete payment"). */}
      <PaymentProgress {...checkoutProgress} />

      {/* Cancel confirmation */}
      <ConfirmModal
        visible={showCancelModal}
        title="Cancel errand?"
        message={
          previewLoading
            ? 'Checking for a cancellation fee…'
            : cancelPreview
              ? cancelMoneyLines(cancelPreview)
              : CANCEL_PREVIEW_FAILED
        }
        // Not confirmable until the fee is known (or its check has failed and
        // the body says one may apply); nor when the server says this errand
        // can't be cancelled any more — the reason above explains why.
        confirmDisabled={previewLoading || cancelPreview?.cancellable === false}
        messageAction={
          previewFailed && !previewLoading
            ? { label: 'Check the fee again', onPress: loadCancelPreview }
            : undefined
        }
        // NOT "Cancel & pay ₱20": on a prepaid errand the fee is DEDUCTED
        // from money the customer already handed over, and a "pay" label read
        // as a fresh charge on top. The fee and the refund are both stated in
        // the body above.
        confirmLabel={
          cancelPreview && cancelPreview.fee > 0
            ? 'Cancel errand'
            : 'Yes, cancel'
        }
        cancelLabel="Keep errand"
        destructive
        loading={isCancelling}
        onConfirm={confirmCancel}
        onCancel={() => {
          setShowCancelModal(false);
          setCancelPreview(null);
          setPreviewFailed(false);
        }}
      />

      {/* SOS confirmation — a custom dialog (not ConfirmModal) so the copy can
          tell the truth about who actually gets alerted and, when the customer
          has no trusted contacts, offer an inline link to add one. */}
      <Modal
        visible={showSOSModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={sosSubmitting ? undefined : () => setShowSOSModal(false)}
      >
        <Pressable
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 24,
            backgroundColor: `${LightColors.ink}73`,
          }}
          onPress={sosSubmitting ? undefined : () => setShowSOSModal(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 380 }}
          >
            <View
              style={{
                backgroundColor: LightColors.surface,
                borderRadius: 20,
                paddingHorizontal: 24,
                paddingTop: 26,
                paddingBottom: 22,
              }}
            >
              <View className="items-center mb-3">
                <View
                  className="w-14 h-14 rounded-full items-center justify-center mb-3"
                  style={{ backgroundColor: LightColors.dangerSoft }}
                >
                  <Shield size={26} color={LightColors.dangerDark} strokeWidth={2.2} />
                </View>
                <Text
                  className="text-[17px] font-montserrat-bold text-textPrimary text-center"
                  maxFontSizeMultiplier={1.3}
                >
                  Emergency SOS
                </Text>
              </View>
              <Text
                className="text-[14px] font-montserrat text-textSecondary text-center"
                style={{ lineHeight: 21 }}
                maxFontSizeMultiplier={1.4}
              >
                {/* Says only what is certain before anything is sent: support
                    gets the alert and, when the phone has a fix, where it is
                    right now. Whether trusted contacts are texted is the
                    SERVER's call (only when SMS is set up) and the card says
                    so after the fact, quoting it — never promised here. */}
                {hasTrustedContacts
                  ? 'This alerts ErrandGuy support and sends your phone’s current location if it’s available, and puts your trusted contacts one tap away to call. In immediate danger, call 911.'
                  : 'This alerts ErrandGuy support and sends your phone’s current location if it’s available. In immediate danger, call 911. You have no trusted contacts saved to call.'}
              </Text>
              {!hasTrustedContacts && (
                <Pressable
                  onPress={() => {
                    setShowSOSModal(false);
                    haptics.selection();
                    router.push('/(customer)/trusted-contacts');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Add a trusted contact"
                  hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                  className="mt-3 self-center"
                  style={({ pressed }) => pressFx(pressed)}
                >
                  <Text className="text-[13px] font-montserrat-bold text-primary text-center">
                    Add a contact
                  </Text>
                </Pressable>
              )}
              <View style={{ gap: 10, marginTop: 20 }}>
                <Button
                  title="Trigger SOS"
                  loadingTitle="Sending…"
                  variant="danger"
                  fullWidth
                  loading={sosSubmitting}
                  disabled={sosSubmitting}
                  onPress={confirmSOS}
                />
                {/* The copy above says "call 911" — the call is one tap, not
                    a number to remember and dial by hand. Works with no data. */}
                <Button
                  title={`Call ${EMERGENCY_NUMBER}`}
                  variant="outline"
                  fullWidth
                  onPress={() => dialNumber(EMERGENCY_NUMBER)}
                />
                <Button
                  title="Cancel"
                  variant="ghost"
                  fullWidth
                  disabled={sosSubmitting}
                  onPress={() => setShowSOSModal(false)}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* No-signal SOS fallback. Open whenever the raise hasn't been
          acknowledged: honest state + the two things that work without data. */}
      <SosPendingSheet
        visible={showSosPending && !!queuedSos}
        contacts={trustedContacts ?? []}
        attempts={queuedSos?.attempts ?? 0}
        sending={sosSending}
        onRetry={retrySosNow}
        onCancelAlert={() => {
          if (!id) return;
          standDownSos(id);
          // Belt AND braces: an attempt whose RESPONSE was lost did reach the
          // server, so a raise we think is unsent may actually be active. The
          // DELETE is a no-op when there's no active alert, so firing it costs
          // nothing and closes that gap.
          void bookingService.deactivateSOS(id).catch(() => {});
          setShowSosPending(false);
          haptics.success();
          toast.success('Alert cancelled — it was never sent');
        }}
        onClose={() => setShowSosPending(false)}
      />

      {booking.runner_id ? (
        <ReportUserSheet
          visible={showReportUser}
          onClose={() => setShowReportUser(false)}
          bookingId={booking.id}
          bookingNumber={booking.booking_number}
          reportedUserId={booking.runner_id}
          reportedName={booking.runner?.full_name?.split(' ')[0] ?? null}
          counterpart="runner"
          onSubmitted={(ticketId) => {
            setShowReportUser(false);
            if (ticketId) router.push(`/(customer)/support/${ticketId}`);
          }}
        />
      ) : null}

      {/* Full-size proof-photo preview (bearer-aware; handles gated media). */}
      <ImageLightbox
        uri={proofPhotoUri}
        visible={!!proofPhotoUri}
        onClose={() => setProofPhotoUri(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // "Frosted" chrome recipe — near-opaque white. expo-blur isn't installed,
  // so opacity + hairline border + Elevation.md stand in for a real blur.
  chromeSurface: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: LightColors.divider,
    ...Elevation.md,
  },
  // Reduce Motion stand-in for the radar rings — same geometry as a ring at
  // full scale so the center puck alignment matches (book/confirm parity).
  staticRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: RING_COLOR,
    backgroundColor: `${RING_COLOR}1A`,
    opacity: 0.6,
  },
  radarCenter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Display rung — the ETA is the handle's hero number. Inter for numerals.
  etaNumeral: {
    fontSize: 34,
    fontFamily: 'Inter_600SemiBold',
    color: LightColors.textPrimary,
    fontVariant: ['tabular-nums'],
    lineHeight: 40,
  },
  // Equal w/h + center anchor — HereMarker's anchor math depends on it.
  pickupPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: LightColors.primary,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    ...Elevation.md,
  },
  // Rounded-square: shape distinguishes dropoff from pickup, not color alone.
  dropoffPin: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: LightColors.ink,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    ...Elevation.md,
  },
  runnerMarkerWrap: {
    alignItems: 'center',
  },
  runnerPulse: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: LightColors.success,
  },
  runnerMarkerOuter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${LightColors.primary}38`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runnerMarkerInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: LightColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: LightColors.surface,
    shadowColor: LightColors.textPrimary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  runnerSpeedBadge: {
    marginTop: 4,
    backgroundColor: `${LightColors.textPrimary}D9`,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  runnerSpeedText: {
    color: LightColors.textInverse,
    // 11px floor — nothing on this screen renders below 11 (a11y/AA pass).
    fontSize: 11,
    fontFamily: 'Quicksand_600SemiBold',
    letterSpacing: 0.2,
  },
});
