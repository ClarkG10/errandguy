import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StatusBar,
  StyleSheet,
  AppState,
  AccessibilityInfo,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Wallet } from 'lucide-react-native';
import { Illustration } from '../../../components/ui/Illustration';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { HereMapView, HereMarker } from '../../../components/map';
import { useBookingStore } from '../../../stores/bookingStore';
import { useBookingStatus } from '../../../hooks/useBookingStatus';
import { useBackGuard } from '../../../hooks/useBackGuard';
import { useForegroundInterval } from '../../../hooks/useForegroundInterval';
import { useSmartPolling } from '../../../hooks/useSmartPolling';
import { useCompleteBookingPayment } from '../../../hooks/useCompleteBookingPayment';
import { useNotificationPermission } from '../../../hooks/useNotificationPermission';
import { turnOnPush } from '../../../services/pushPermission';
import { bookingService } from '../../../services/booking.service';
import { errorMessage, LEGACY_WORDED_REFUSALS } from '../../../utils/errorCatalog';
import { haptics } from '../../../utils/haptics';
import { copy } from '../../../constants/copy';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { SuccessCheck } from '../../../components/ui/SuccessCheck';
import { RunnerSearchAnimation } from '../../../components/customer/RunnerSearchAnimation';
import { PaymentProgress } from '../../../components/ui/PaymentProgress';
import {
  isAwaitingPayment,
  paymentDeadlineLine,
  UNPAID_CANCEL_TITLE,
  unpaidCancelMessage,
  wasCancelledForUnpaidPayment,
} from '../../../utils/bookingPayment';
import { cancelMoneyLines, cancelReceiptMessage, type CancelPreview } from '../../../utils/cancelPreview';
import { canRetryMatch, noRunnerRebookLine } from '../../../utils/noRunner';
import { rebookDraft } from '../../../utils/rebookDraft';
import { formatCurrency } from '../../../utils/formatCurrency';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import { BookingSuccess, type BookingSuccessRow } from '../../../components/customer/booking/BookingSuccess';
import { LivePulse } from '../../../components/customer/booking/LivePulse';
import { paymentMethodLabel } from '../../../components/customer/booking/paymentMethods';
import type { Booking, BookingStatus } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { LightColors, Elevation } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import dayjs from 'dayjs';


// 'awaiting_payment': a GCash/Maya booking the server holds back from runners
// until its payment is confirmed — nobody is being looked for yet.
type SearchState =
  | 'awaiting_payment'
  | 'searching'
  | 'scheduled'
  | 'matched'
  | 'no_runner'
  | 'cancelled';

// Rotating reassurance copy while searching — cycled every ~5s so a
// longer wait never reads as a frozen screen.
const SEARCHING_LINES = [
  'Contacting nearby runners…',
  'Hang tight — finding your best match…',
  'Still searching — good runners are worth the wait…',
] as const;

// Screen-reader announcements for each state transition.
const STATE_ANNOUNCEMENTS: Record<SearchState, string> = {
  awaiting_payment: 'Waiting for your payment. No runner is contacted until it goes through.',
  searching: 'Searching for a runner nearby',
  scheduled: 'Errand scheduled. We will match a runner near your scheduled time.',
  matched: 'Runner found. Redirecting to tracking.',
  no_runner: 'No runners available right now.',
  cancelled: 'Errand cancelled.',
};

/**
 * How long the search reads as "looking" before the copy turns to a calmer
 * "still looking". This is NOT a deadline. Matching runs on the server — each
 * direct offer gives one runner 90 seconds to answer before the next is tried —
 * and only the server decides nobody is free, by moving the booking to
 * `no_runner`. The client used to call it at 60s on its own clock, telling the
 * customer "No runners available" while a runner was still holding the offer.
 */
export const STILL_LOOKING_AFTER_MS = 60_000;

const STILL_LOOKING_LINE =
  'Taking longer than usual — we’ll keep trying and tell you if no runner is free.';
const STILL_LOOKING_ANNOUNCEMENT = 'Still looking for a runner.';

export default function ConfirmScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
  const draftBooking = useBookingStore((s) => s.draftBooking);
  const updateDraft = useBookingStore((s) => s.updateDraft);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const setStep = useBookingStore((s) => s.setStep);

  const bookingId = params.bookingId ?? activeBooking?.id;

  // A booking scheduled for a FUTURE time must NOT run the live "searching"
  // radar — the server delays matching until near the scheduled slot, so the
  // screen would sit on "Looking for a runner" for hours. Detect it from
  // whichever source is populated (the created booking, or the draft on the
  // normal create flow) and land on a "scheduled" confirmation instead.
  const scheduledSource = activeBooking ?? draftBooking;
  // Pickup coords for the searching map (re-enabled per request — this bills
  // HERE tiles for the search duration). Falls back to the gradient if absent.
  // Laravel casts decimal columns to strings ("8.94120787") and the map camera
  // silently falls back to the globe view on a string, so coerce with Number().
  const pickupLat = Number(scheduledSource?.pickup_lat);
  const pickupLng = Number(scheduledSource?.pickup_lng);
  const hasPickup = Number.isFinite(pickupLat) && Number.isFinite(pickupLng);
  const scheduledAtMs = scheduledSource?.scheduled_at
    ? Date.parse(scheduledSource.scheduled_at)
    : NaN;
  const isScheduledFuture =
    scheduledSource?.schedule_type === 'scheduled' &&
    Number.isFinite(scheduledAtMs) &&
    scheduledAtMs > Date.now();

  const [state, setState] = useState<SearchState>(
    isAwaitingPayment(activeBooking?.id === bookingId ? activeBooking : null)
      ? 'awaiting_payment'
      : isScheduledFuture
        ? 'scheduled'
        : 'searching',
  );
  // The booking as it was when it ended. A cancelled booking is cleared from
  // the store, but "Book again" still needs its details and the copy needs
  // its reason.
  const [endedBooking, setEndedBooking] = useState<Booking | null>(null);

  // Cost guard: HERE tiles bill for the whole search, so show the live map for
  // the first stretch of the wait, then fall back to the free gradient on a
  // long search. Per screen mount.
  const [mapExpired, setMapExpired] = useState(false);
  useEffect(() => {
    if (state !== 'searching' || !hasPickup) return;
    const t = setTimeout(() => setMapExpired(true), 45000);
    return () => clearTimeout(t);
  }, [state, hasPickup]);
  const showSearchMap = state === 'searching' && hasPickup && !mapExpired;

  // "You can leave, it keeps searching" is only half true with notifications
  // off: the search goes on, but "runner found" never reaches the customer.
  // Say so where they wait, with the fix one tap away — the OS prompt while
  // one is left, otherwise the phone's Settings (turnOnPush).
  const pushPermission = useNotificationPermission(
    state === 'searching' || state === 'scheduled',
  );
  const notificationsOff = pushPermission === 'denied' || pushPermission === 'undetermined';
  // `inset` lines the copy up under the success screen's status text.
  const renderNotificationsOff = (inset = false) =>
    notificationsOff ? (
      <View className={inset ? 'mt-3' : 'mt-3 items-center'} style={inset ? { marginLeft: 36 } : null}>
        <Text
          className={`text-[13px] font-montserrat text-textSecondary ${inset ? '' : 'text-center'}`}
        >
          {state === 'scheduled'
            ? 'Notifications are off, so we can’t tell you when a runner is found.'
            : 'Notifications are off. If you leave this screen, we can’t tell you when a runner is found.'}
        </Text>
        <Pressable
          onPress={() => {
            void turnOnPush();
          }}
          accessibilityRole="button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <Text className="text-sm font-montserrat-bold text-primary mt-1">
            Turn on notifications
          </Text>
        </Pressable>
      </View>
    ) : null;

  // Cold-start / deep-link (e.g. returning from Xendit checkout after the app
  // was killed): the store may hydrate the scheduled booking only after mount,
  // so flip out of the guessed "searching" once we learn it's scheduled.
  useEffect(() => {
    if (isScheduledFuture && state === 'searching') setState('scheduled');
  }, [isScheduledFuture, state]);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  // The server's own cancel preview — what cancelling costs and what comes
  // back. The modal used to promise a free cancel on its own say-so.
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // The preview request failed: the confirm says a fee MAY apply and offers a
  // re-check (see tracking's cancel, which works the same way).
  const [previewFailed, setPreviewFailed] = useState(false);
  // Only the newest preview request may write its answer.
  const previewSeqRef = useRef(0);
  // A fresh read of the booking once it went no_runner. The realtime event that
  // announces no_runner carries lifecycle fields only, so the store copy still
  // holds the PENDING booking's `can_retry_match` (true) and none of the
  // refund. 'unknown' = the read failed; behave as before (the server still
  // refuses a retry it can't run, in its own words).
  const [noRunnerVerdict, setNoRunnerVerdict] = useState<Booking | 'unknown' | null>(null);
  // Tracks how many widened-radius retries the customer has used so the
  // server keeps fanning the search out instead of repeating the same one.
  const [retryStep, setRetryStep] = useState<1 | 2 | 3>(1);
  const [isRetrying, setIsRetrying] = useState(false);
  // True once a widest-radius (step 3) retry has also come back no_runner —
  // at that point another identical retry would just be theatre, so the UI
  // swaps to a rebook path instead.
  const [exhausted, setExhausted] = useState(false);
  const retriedAtMaxRef = useRef(false);
  const [bookingNumber, setBookingNumber] = useState(
    activeBooking?.booking_number ?? '',
  );
  // Single safety-net poll. Primary source of truth is realtime via
  // useBookingStatus below — polling is only a fallback in case the
  // socket ever drops. The poller itself lives further down in a
  // `useForegroundInterval` so it pauses while backgrounded; setting
  // `state` to anything other than 'searching' tears it down.

  // Deep-link / cold-launch guard: if we somehow landed here with no
  // bookingId in either route params or store, there's nothing to wait
  // for. Send the user home rather than render a frozen "Searching..."
  // forever.
  useEffect(() => {
    if (!bookingId) {
      toast.error('Couldn’t find this errand. Please try again.');
      router.replace('/(customer)/(tabs)');
    }
  }, [bookingId, router]);

  // When the CURRENT search began (reset by "Search again"). Wall-clock, so a
  // backgrounded app comes back on the truth rather than a frozen tick.
  const searchStartedAtRef = useRef<number>(Date.now());
  const [stillLooking, setStillLooking] = useState(false);

  // Cold-start / deep-link hydration (e.g. returning from the Xendit
  // checkout after the app was killed): the store has no activeBooking, and
  // the realtime merge can't hydrate a null store. Fetch the booking now
  // rather than waiting up to 30s for the safety-net poll.
  const hydratingRef = useRef(false);
  useEffect(() => {
    if (
      !bookingId ||
      activeBooking?.id === bookingId ||
      hydratingRef.current ||
      // A cancelled booking is cleared from the store on purpose; fetching it
      // back would re-run the cancel branch, clear it again, and loop.
      state === 'cancelled'
    ) {
      return;
    }
    hydratingRef.current = true;
    bookingService
      .getBooking(bookingId)
      .then((res) => {
        const fresh = res.data.data;
        if (!fresh) return;
        setBookingNumber(fresh.booking_number ?? '');
        // The mirror effect below runs reactToStatus on this, so an
        // already-matched/cancelled booking transitions immediately.
        setActiveBooking(fresh);
      })
      .catch(() => {})
      .finally(() => {
        hydratingRef.current = false;
      });
  }, [bookingId, activeBooking?.id, setActiveBooking, state]);

  // Rotating searching subtitle — plain setState on an interval, torn
  // down on unmount or as soon as we leave the searching state.
  const [searchLineIdx, setSearchLineIdx] = useState(0);
  useEffect(() => {
    if (state !== 'searching') return;
    const interval = setInterval(() => {
      setSearchLineIdx((i) => (i + 1) % SEARCHING_LINES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [state]);

  // Outcome haptics + polite screen-reader announcement on state
  // transitions. 'matched' is intentionally silent here — SuccessCheck
  // fires its own success haptic when it mounts.
  const prevStateRef = useRef<SearchState>(state);
  useEffect(() => {
    if (prevStateRef.current === state) return;
    prevStateRef.current = state;
    if (state === 'searching') {
      // The search starts NOW — after a payment that took five minutes, the
      // "still looking" clock must not already have run out.
      searchStartedAtRef.current = Date.now();
      setStillLooking(false);
    }
    if (state === 'no_runner') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
    } else if (state === 'cancelled') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    AccessibilityInfo.announceForAccessibility(STATE_ANNOUNCEMENTS[state]);
  }, [state]);

  // Flip the copy to "still looking" once the search has run a while. Only the
  // WORDS change — "No runners available" waits for the server's own
  // `no_runner` (see reactToStatus). `useForegroundInterval` pauses while
  // backgrounded; the start time is wall-clock, so the first tick on resume
  // catches up at once.
  const tickStillLooking = useCallback(() => {
    if (Date.now() - searchStartedAtRef.current >= STILL_LOOKING_AFTER_MS) {
      setStillLooking(true);
    }
  }, []);
  useForegroundInterval(tickStillLooking, 1000, state === 'searching' && !stillLooking);

  // Say the shift out loud too — the headline swap is visual only.
  useEffect(() => {
    if (state === 'searching' && stillLooking) {
      AccessibilityInfo.announceForAccessibility(STILL_LOOKING_ANNOUNCEMENT);
    }
  }, [state, stillLooking]);

  // Resync booking status whenever the app comes back to the foreground —
  // realtime channels can miss events while suspended on Android.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !bookingId || state !== 'searching') return;
      bookingService
        .getBooking(bookingId)
        .then((res) => {
          // reactToStatus is defined further below — read fresh via store
          const fresh = res.data.data;
          setBookingNumber(fresh?.booking_number ?? '');
          // Mirror into store so the existing reactToStatus effect picks it up.
          setActiveBooking(fresh);
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, [bookingId, state, setActiveBooking]);

  // Block accidental Android hardware-back / gesture-back during the
  // search — first press shows a hint, second press inside 2s falls
  // through. Cancellation should go through the explicit Cancel button.
  useBackGuard(
    state === 'searching' || state === 'awaiting_payment',
    state === 'awaiting_payment'
      ? 'Tap back again to leave — you can finish paying from your errand on Home.'
      : 'Tap back again to leave — we’ll keep looking for a runner.',
  );

  // ── Realtime status updates ──
  // Subscribes to Reverb realtime; reacts to status transitions instantly
  // instead of polling every 3s. We still keep one fallback fetch every 30s
  // in case the socket disconnects (handled below).
  useBookingStatus(bookingId ?? null);

  // The matched → accepted → heading_to_pickup burst re-runs reactToStatus
  // once per status; only the first may schedule the replace, or later
  // timers would remount the tracking screen on top of itself.
  const handedOffRef = useRef(false);
  const handoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (handoffTimerRef.current) clearTimeout(handoffTimerRef.current);
    },
    [],
  );

  const reactToStatus = useCallback(
    (booking: any) => {
      if (!booking) return;
      setBookingNumber(booking.booking_number ?? '');
      const status: BookingStatus = booking.status;
      if (
        status === 'matched' ||
        status === 'accepted' ||
        status === 'heading_to_pickup'
      ) {
        setState('matched');
        setActiveBooking(booking);
        if (!handedOffRef.current) {
          handedOffRef.current = true;
          // 1200ms dwell matches SuccessCheck's celebrate duration.
          handoffTimerRef.current = setTimeout(() => {
            if (bookingId) router.replace(`/(customer)/tracking/${bookingId}`);
          }, 1200);
        }
      } else if (status === 'cancelled') {
        setEndedBooking(booking);
        setState('cancelled');
        setActiveBooking(null);
      } else if ((status as string) === 'no_runner') {
        setState('no_runner');
        if (retriedAtMaxRef.current) setExhausted(true);
      } else if (status === 'pending') {
        // GCash/Maya: nobody is offered the errand until it's paid. The
        // moment it is, the ordinary search (or scheduled wait) takes over.
        setState((s) =>
          isAwaitingPayment(booking)
            ? 'awaiting_payment'
            : s === 'awaiting_payment'
              ? 'searching'
              : s,
        );
      }
    },
    [bookingId, router, setActiveBooking],
  );

  // Mirror activeBooking changes (which the realtime hook updates) into UI
  useEffect(() => {
    if (activeBooking?.id === bookingId) reactToStatus(activeBooking);
  }, [activeBooking, bookingId, reactToStatus]);

  // Fallback safety-net poll every 30s — only fires if realtime didn't
  // already transition us out of "searching". The axios layer dedupes any
  // bursts, so this is effectively at most 2 requests per minute. Using
  // `useForegroundInterval` so we don't burn cellular while suspended;
  // the AppState listener already re-syncs immediately on resume above.
  const pollSafetyNet = useCallback(async () => {
    if (!bookingId) return;
    // Let errors propagate so useSmartPolling can back off — realtime is the
    // primary channel and will catch up regardless.
    const res = await bookingService.getBooking(bookingId);
    reactToStatus(res.data.data);
  }, [bookingId, reactToStatus]);
  // Smart poll: only while searching + foreground + online, and back off if
  // the safety-net request starts failing. Stops the instant a runner is
  // matched (state leaves 'searching') per the booking-queue polling rule.
  useSmartPolling(pollSafetyNet, {
    interval: 30000,
    enabled: !!bookingId && state === 'searching',
    runOnMount: false, // realtime already seeds status
  });

  // Written through the store so the mirror effect above judges it — and so
  // the store never keeps a stale `awaiting_payment` that a later realtime
  // merge would resurrect.
  const refreshBooking = useCallback(async () => {
    if (!bookingId) return;
    const res = await bookingService.getBooking(bookingId);
    const fresh = res?.data?.data;
    if (fresh?.id === bookingId) setActiveBooking(fresh);
  }, [bookingId, setActiveBooking]);

  // Once no runner took it, ask the server — not the merged realtime copy —
  // whether searching again can work (see noRunnerVerdict). Skips the micro-
  // cache: a read from seconds ago would still be the pending booking.
  useEffect(() => {
    if (state !== 'no_runner' || noRunnerVerdict !== null || !bookingId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await bookingService.getBooking(bookingId, { fresh: true });
        const fresh = res?.data?.data;
        if (cancelled) return;
        if (fresh?.id === bookingId && fresh.status === 'no_runner') {
          setNoRunnerVerdict(fresh);
          setActiveBooking(fresh);
        } else if (fresh?.id === bookingId) {
          // It moved on (matched, cancelled…) — let reactToStatus take it.
          setNoRunnerVerdict('unknown');
          setActiveBooking(fresh);
        } else {
          setNoRunnerVerdict('unknown');
        }
      } catch {
        if (!cancelled) setNoRunnerVerdict('unknown');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, noRunnerVerdict, bookingId, setActiveBooking]);

  // Waiting for a GCash/Maya payment. Its confirmation doesn't change the
  // status (still `pending`), so no realtime event announces it — tail the
  // booking instead: once on arrival (the stored copy may be the create
  // response from before the customer paid), every 10s, and on every return
  // to the app, which is exactly when a customer comes back from GCash/Maya.
  useSmartPolling(refreshBooking, {
    interval: 10_000,
    enabled: !!bookingId && state === 'awaiting_payment',
    runOnMount: true,
  });

  const loadCancelPreview = useCallback(() => {
    if (!bookingId) return;
    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    setPreviewFailed(false);
    bookingService
      .cancelPreview(bookingId)
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
  }, [bookingId]);

  const handleCancel = useCallback(() => {
    if (!bookingId) return;
    setShowCancelModal(true);
    loadCancelPreview();
  }, [bookingId, loadCancelPreview]);

  const handleConfirmCancel = useCallback(async () => {
    if (!bookingId) return;
    setIsCancelling(true);
    try {
      const res = await bookingService.cancelBooking(bookingId, 'Customer cancelled');
      setState('cancelled');
      setActiveBooking(null);
      setShowCancelModal(false);
      setCancelPreview(null);
      // Navigation preempts the cancelled-state render, so close the loop
      // here with the server's own receipt: the fee actually kept, what was
      // refunded and where it went (same as tracking's cancel).
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      toast.success(cancelReceiptMessage(res) ?? copy.booking.cancelled);
      router.replace('/(customer)/(tabs)');
    } catch (err) {
      haptics.error();
      toast.error(errorMessage(err, copy.booking.cancelFailed));
    } finally {
      setIsCancelling(false);
    }
  }, [bookingId, setActiveBooking, router]);

  const handleRetry = useCallback(async () => {
    if (!bookingId || isRetrying) return;
    // Step 1 = original radius, 2 = ~1.75x, 3 = ~2.5x. After 3 we stop
    // pretending we can find someone and steer the user to alternatives.
    const step = Math.min(retryStep, 3) as 1 | 2 | 3;
    setIsRetrying(true);
    try {
      const res = await bookingService.retryMatch(bookingId, step);
      // A widest-radius attempt is in flight — if this one also comes back
      // no_runner, that outcome is terminal (see `exhausted`).
      if (step === 3) retriedAtMaxRef.current = true;
      setRetryStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : 3));
      searchStartedAtRef.current = Date.now();
      setStillLooking(false);
      setState('searching');
      // The server runs this match inline and answers with the booking as it
      // now stands — matched already, still pending, or no_runner again.
      // Hand it to the store so reactToStatus judges THAT, never the
      // no_runner snapshot the store still holds from the last search.
      const fresh = res?.data?.data;
      if (fresh?.id === bookingId) {
        // A full BookingResource: if this search came back empty too, it is
        // also the verdict on searching again.
        setNoRunnerVerdict(fresh.status === 'no_runner' ? fresh : null);
        setActiveBooking(fresh);
      }
    } catch (err: any) {
      // A refusal is worded by the server for THIS errand (refunded, unpaid,
      // scheduled…). RETRY_NOT_ALLOWED already passes through; an older server
      // sent the same sentences as BOOKING_CONFLICT, whose catalog copy ("You
      // already have an errand") was wrong for a customer with no other one.
      toast.error(
        errorMessage(err, 'Could not retry matching right now. Try again in a moment.', {
          trustServerMessageFor: LEGACY_WORDED_REFUSALS,
        }),
      );
      // The server won't search this errand again: dropping the verdict makes
      // the no_runner effect re-read it, so the card swaps to Book again (or
      // shows the match that just landed).
      if (err?.status === 409) setNoRunnerVerdict(null);
    } finally {
      setIsRetrying(false);
    }
  }, [bookingId, isRetrying, retryStep, setActiveBooking]);

  // Terminal no_runner recovery: the draft was cleared at submit, so
  // "rebook" would otherwise mean full re-entry. Re-seed the draft from
  // the failed booking and drop the user on the review step where the
  // details that matter for matching (vehicle, timing) are editable.
  const handleRebook = useCallback(() => {
    const b = activeBooking ?? endedBooking;
    if (!b) {
      router.replace('/(customer)/book/type');
      return;
    }
    clearDraft();
    updateDraft(rebookDraft(b));
    setStep(3);
    setActiveBooking(null);
    router.replace('/(customer)/book/review');
  }, [activeBooking, endedBooking, clearDraft, updateDraft, setStep, setActiveBooking, router]);

  const { checkoutUrl, completePayment, opening, progress } = useCompleteBookingPayment(
    // The ended booking too: a declined charge cancels the errand, and the
    // overlay explaining that must not vanish the instant the re-read lands.
    activeBooking?.id === bookingId
      ? activeBooking
      : endedBooking?.id === bookingId
        ? endedBooking
        : null,
    // A verdict (or closing the overlay) re-reads the booking: a confirmed
    // payment is what starts the search.
    {
      onSettled: () => void refreshBooking().catch(() => {}),
      onRebook: handleRebook,
    },
  );

  const cancelledUnpaid = state === 'cancelled' && wasCancelledForUnpaidPayment(endedBooking);
  // Searching again is off the table (prepaid and refunded, typically): lead
  // with Book again and say where the money went, instead of a "Search again"
  // the server can only refuse.
  const verdictBooking = noRunnerVerdict && noRunnerVerdict !== 'unknown' ? noRunnerVerdict : null;
  const retryRefused = state === 'no_runner' && !!verdictBooking && !canRetryMatch(verdictBooking);
  const verdictPending = state === 'no_runner' && noRunnerVerdict === null;

  // ── The success moment ──────────────────────────────────────────────
  // A freshly booked errand (first search, or a scheduled one) lands on the
  // success screen: what was booked, then what happens next. The live search
  // still runs underneath it — realtime, the safety-net poll, the matched
  // hand-off to tracking — exactly as on the map layout. After "Search again"
  // the screen is no longer news, so retries use the map layout below.
  const showBookedSuccess = (state === 'searching' && retryStep === 1) || state === 'scheduled';
  const summaryBooking: Booking | null =
    activeBooking?.id === bookingId ? activeBooking : null;
  const summaryRule = getErrandTypeRule(summaryBooking?.errand_type?.slug);
  const summaryTotal = Number(summaryBooking?.total_amount);
  const successFacts = [
    bookingNumber || summaryBooking?.booking_number,
    Number.isFinite(summaryTotal) && summaryTotal > 0 ? formatCurrency(summaryTotal) : null,
    paymentMethodLabel(summaryBooking?.payment_method),
  ];
  const stopCount = summaryBooking?.stops?.length ?? 0;
  const successRows: BookingSuccessRow[] = [
    ...(state === 'scheduled' && Number.isFinite(scheduledAtMs)
      ? [{ label: 'When', value: dayjs(scheduledAtMs).format('ddd, MMM D · h:mm A') }]
      : []),
    ...(summaryBooking?.pickup_address
      ? [{ label: summaryRule.pickupLabel, value: summaryBooking.pickup_address }]
      : []),
    ...(summaryBooking?.dropoff_address && !summaryRule.singleLocation
      ? [{ label: summaryRule.dropoffLabel, value: summaryBooking.dropoff_address }]
      : []),
    ...(stopCount > 0
      ? [{ label: 'Extra stops', value: `${stopCount} more ${stopCount === 1 ? 'stop' : 'stops'}` }]
      : []),
  ];
  const goToErrand = useCallback(() => {
    if (bookingId) router.replace(`/(customer)/tracking/${bookingId}`);
  }, [bookingId, router]);
  const goHome = useCallback(() => router.replace('/(customer)/(tabs)'), [router]);

  const liveAnnouncement =
    state === 'searching' && stillLooking
      ? STILL_LOOKING_ANNOUNCEMENT
      : cancelledUnpaid
        ? `${UNPAID_CANCEL_TITLE}. ${unpaidCancelMessage(endedBooking)}`
        : STATE_ANNOUNCEMENTS[state];

  // Keyed, so the payment overlay keeps its place when the screen switches
  // between the success layout and the map layout (an unpaid booking's
  // payment landing): unkeyed, it sat at a different child index in each and
  // was remounted while visible — a flash, or a dismiss and re-present on iOS.
  const overlays = (
    <React.Fragment key="overlays">
      <ConfirmModal
        visible={showCancelModal}
        title="Cancel this errand?"
        // The server's preview, never a promise of our own: it names any fee
        // and what goes back to the wallet (same body tracking shows).
        message={
          previewLoading
            ? 'Checking for a cancellation fee…'
            : cancelPreview
              ? cancelMoneyLines(cancelPreview)
              : 'We couldn’t check for a cancellation fee just now. If a runner has already accepted your errand, a small fee may apply. This can’t be undone.'
        }
        // Not confirmable until the fee is known (or its check failed and the
        // body says one may apply), nor when the server says it can't be
        // cancelled any more.
        confirmDisabled={previewLoading || cancelPreview?.cancellable === false}
        messageAction={
          previewFailed && !previewLoading
            ? { label: 'Check the fee again', onPress: loadCancelPreview }
            : undefined
        }
        confirmLabel="Cancel errand"
        confirmLoadingLabel="Cancelling…"
        cancelLabel={state === 'awaiting_payment' ? 'Keep errand' : 'Keep searching'}
        destructive
        loading={isCancelling}
        onConfirm={handleConfirmCancel}
        onCancel={() => {
          setShowCancelModal(false);
          setCancelPreview(null);
          setPreviewFailed(false);
        }}
      />

      {/* Verifies a reopened GCash/Maya checkout (the "Pay" button). */}
      <PaymentProgress {...progress} />
    </React.Fragment>
  );

  if (showBookedSuccess) {
    const searching = state === 'searching';
    return (
      <View style={{ flex: 1, backgroundColor: LightColors.surface }}>
        <StatusBar barStyle="dark-content" />
        <Text accessibilityLiveRegion="polite" style={cs.srOnly} importantForAccessibility="yes">
          {liveAnnouncement}
        </Text>
        <BookingSuccess
          title={searching ? 'Errand booked' : 'Errand scheduled'}
          facts={successFacts}
          rows={successRows}
          // Review already fired the success haptic when the server took it.
          haptic={false}
          announcement={
            searching
              ? 'Errand booked. Looking for a runner nearby.'
              : 'Errand scheduled. We will match a runner near your scheduled time.'
          }
          next={
            <>
              <View className="flex-row items-start" style={{ gap: 10 }}>
                {searching ? (
                  <LivePulse />
                ) : (
                  <View style={{ width: 26, height: 26 }} className="items-center justify-center">
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: LightColors.primary }} />
                  </View>
                )}
                <View className="flex-1">
                  <Text className="text-[15px] font-montserrat-bold text-textPrimary" style={{ lineHeight: 26 }}>
                    {searching
                      ? stillLooking
                        ? 'Still looking…'
                        : 'Looking for a runner nearby…'
                      : 'What happens next'}
                  </Text>
                  <Text className="text-[13px] font-montserrat text-textSecondary leading-[19px]">
                    {!searching
                      ? 'We’ll match you with a runner shortly before your scheduled time. Track it anytime from Activity.'
                      : stillLooking
                        ? STILL_LOOKING_LINE
                        : pushPermission === 'granted'
                          ? 'You’ll get a notification when one accepts — you can leave this screen.'
                          : SEARCHING_LINES[searchLineIdx]}
                  </Text>
                </View>
              </View>
              {renderNotificationsOff(true)}
            </>
          }
          primary={{
            title: searching ? 'Track errand' : 'View errand',
            onPress: goToErrand,
          }}
          secondary={{ title: 'Back to home', onPress: goHome }}
          footer={
            searching ? (
              <Button
                title="Cancel errand"
                variant="ghost"
                onPress={handleCancel}
                disabled={isCancelling}
                fullWidth
              />
            ) : undefined
          }
        />
        {overlays}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* The whole screen is the dark brand gradient — status-bar icons
          must be light or they vanish against #1E40AF. Mounting last in
          the stack, this wins over the soft headers below and pops back
          off when the screen unmounts. */}
      <StatusBar barStyle="light-content" />
      {/* Backdrop. While searching we show a live map centered on the pickup
          (re-enabled per request — streams billed HERE tiles for the search);
          every other state keeps the zero-cost brand gradient. */}
      {showSearchMap ? (
        <>
          <HereMapView
            style={StyleSheet.absoluteFill}
            showsMyLocationButton={false}
            showsCompass={false}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            maxZoomLevel={16}
            initialRegion={{
              latitude: pickupLat,
              longitude: pickupLng,
              latitudeDelta: 0.014,
              longitudeDelta: 0.014,
            }}
          >
            {/* Pickup marker doubles as the search radar — the expanding rings
                emanate from the real pickup coordinate and pan with the map. */}
            <HereMarker
              coordinate={{ latitude: pickupLat, longitude: pickupLng }}
              anchor={{ x: 0.5, y: 0.5 }}
              id="pickup"
            >
              <View style={cs.searchPulse}>
                <RunnerSearchAnimation size={130} />
              </View>
            </HereMarker>
          </HereMapView>
          {/* Readable scrim: near-solid at the top (status-bar) and bottom
              (behind the card), light through the middle so the map shows
              around the pickup where the search pulse sits. */}
          <LinearGradient
            pointerEvents="none"
            colors={[
              `${LightColors.gradientStart}F2`,
              `${LightColors.gradientMid}55`,
              `${LightColors.gradientEnd}F2`,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
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
      )}

      {/* Bottom card */}
      <SafeAreaView style={cs.overlay} edges={['top']}>
        {/* Pulse lives inside the spacer so it centers in the free area
            ABOVE the card — centered on the full screen, the bottom of
            the 200pt ring hides behind the card on SE-height phones. */}
        <View style={{ flex: 1 }}>
          {/* Radar lives on the map's pickup pin when the map shows; only the
              gradient fallback (cost-guard expired / no coords) uses this
              centered pulse. */}
          {state === 'searching' && !showSearchMap && <RunnerSearchAnimation />}
        </View>
        {/* Polite live region (Android) — mirrors the iOS announce call in
            the state-transition effect so screen readers hear searching →
            matched / no_runner / cancelled without focus moving. */}
        <Text
          accessibilityLiveRegion="polite"
          style={cs.srOnly}
          importantForAccessibility="yes"
        >
          {liveAnnouncement}
        </Text>
        <View
          style={[
            cs.card,
            {
              // Sheet sits flush on the physical bottom edge; the home
              // indicator / Android nav-bar inset is absorbed into the
              // card's own padding (BottomActionBar idiom) instead of
              // floating the card above a strip of gradient.
              paddingBottom: 24 + Math.max(insets.bottom, 8),
              // Tablets: clamp to the same readable column the rest of
              // the funnel uses rather than stretching edge to edge.
              maxWidth: contentMaxWidth,
              width: '100%',
              alignSelf: 'center',
            },
          ]}
        >
          {state === 'awaiting_payment' && (
            <>
              <View style={cs.payBadge}>
                <Wallet size={28} color={LightColors.primary} strokeWidth={2} />
              </View>
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                Waiting for your payment
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                We&apos;ll start finding a runner the moment your payment goes
                through. {paymentDeadlineLine(activeBooking, (ms) => dayjs(ms).format('h:mm A'))}
              </Text>
              <Text className="text-xs font-montserrat text-textTertiary mt-2 text-center">
                Already paid? This updates by itself.
              </Text>
              {bookingNumber ? (
                <Text className="text-xs font-inter text-textTertiary mt-2 text-center">
                  Booking: {bookingNumber}
                </Text>
              ) : null}
              <View className="mt-5 w-full gap-3">
                {checkoutUrl ? (
                  <Button
                    // The same words as Home and tracking ("Pay ₱95.00").
                    title={Number.isFinite(summaryTotal) && summaryTotal > 0 ? `Pay ${formatCurrency(summaryTotal)}` : 'Pay now'}
                    onPress={completePayment}
                    loading={opening}
                    loadingTitle="Opening checkout…"
                    fullWidth
                  />
                ) : null}
                <Button
                  title="Cancel errand"
                  variant="outline"
                  onPress={handleCancel}
                  disabled={isCancelling}
                  fullWidth
                />
              </View>
            </>
          )}

          {state === 'searching' && (
            <>
              <Text className="text-xl font-montserrat-bold text-textPrimary text-center">
                {stillLooking ? 'Still looking…' : 'Looking for a runner nearby…'}
              </Text>
              {/* Rotating reassurance line — cycles every ~5s, then settles on
                  the "still looking" note. Two lines of height are reserved
                  so the card (and the pulse centered above it) doesn't jump
                  when a longer line wraps on narrow phones. */}
              <Text
                className="text-sm font-montserrat text-textSecondary mt-1 text-center"
                style={{ minHeight: 36 }}
              >
                {stillLooking ? STILL_LOOKING_LINE : SEARCHING_LINES[searchLineIdx]}
              </Text>
              {bookingNumber ? (
                // Inter for the booking number — data-dense identifiers
                // use the numeric face per the type convention.
                <Text className="text-xs font-inter text-textTertiary mt-2 text-center">
                  Booking: {bookingNumber}
                </Text>
              ) : null}
              {renderNotificationsOff()}
              <View className="mt-5 w-full">
                <Button
                  title="Cancel errand"
                  variant="outline"
                  onPress={handleCancel}
                  disabled={isCancelling}
                  fullWidth
                />
              </View>
            </>
          )}

          {state === 'matched' && (
            <>
              {/* Branded match illustration over the animated check —
                  SuccessCheck still fires the success haptic on mount. */}
              <View style={{ alignSelf: 'center', alignItems: 'center' }}>
                <Illustration name="success-matched" size={148} style={{ marginBottom: 4 }} />
                <SuccessCheck celebrate size={72} />
              </View>
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                Runner found
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                Redirecting to tracking…
              </Text>
            </>
          )}

          {state === 'no_runner' && (
            <>
              {/* Distinct "no runner" scene — "no match found" and
                  "cancelled" stay distinguishable by illustration, not
                  color alone. */}
              <Illustration name="error-no-runner" size={150} style={{ alignSelf: 'center' }} />
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                No runners available
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                {exhausted
                  ? 'We searched our widest area and no runner picked this up. Rebooking with different details — vehicle or timing — gives the best chance.'
                  : retryRefused
                    ? noRunnerRebookLine(verdictBooking)
                    : retryStep === 1
                      ? 'No runners are nearby right now. We can widen the search area.'
                      : retryStep === 2
                        ? 'Still no luck. We can search a much larger area, but ETA will be longer.'
                        : 'One more try at our widest search area.'}
              </Text>
              <View className="mt-5 w-full gap-3">
                {exhausted ? (
                  <Button
                    title="Rebook with new details"
                    onPress={handleRebook}
                    fullWidth
                  />
                ) : retryRefused ? (
                  <Button
                    title="Book again"
                    onPress={handleRebook}
                    accessibilityHint="Starts a new errand pre-filled from this one"
                    fullWidth
                  />
                ) : (
                  // Held on "Checking…" for the moment it takes to ask the
                  // server whether a search can still run, so a refunded
                  // errand never flashes a Search again it would refuse.
                  <Button
                    title={
                      retryStep === 1
                        ? 'Search again'
                        : retryStep === 2
                          ? 'Widen search area'
                          : 'Search widest area'
                    }
                    onPress={handleRetry}
                    loading={isRetrying || verdictPending}
                    loadingTitle={verdictPending ? 'Checking…' : 'Searching…'}
                    fullWidth
                  />
                )}
                <Button
                  title="Back to home"
                  variant="outline"
                  onPress={() => router.replace('/(customer)/(tabs)')}
                  fullWidth
                />
              </View>
            </>
          )}

          {/* Cancelled because the GCash/Maya payment never went through —
              said plainly, with the way forward, instead of a generic
              "no longer active". */}
          {cancelledUnpaid && (
            <>
              <Illustration name="error-payment-failed" size={150} style={{ alignSelf: 'center' }} />
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                {UNPAID_CANCEL_TITLE}
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                {unpaidCancelMessage(endedBooking)}
              </Text>
              <View className="mt-5 w-full gap-3">
                <Button title="Book again" onPress={handleRebook} fullWidth />
                <Button
                  title="Back to home"
                  variant="outline"
                  onPress={() => router.replace('/(customer)/(tabs)')}
                  fullWidth
                />
              </View>
            </>
          )}

          {state === 'cancelled' && !cancelledUnpaid && (
            <>
              <Illustration name="booking-cancelled" size={150} style={{ alignSelf: 'center' }} />
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                Errand cancelled
              </Text>
              {/* This card only shows for a server-side cancellation —
                  a customer cancel navigates home directly. */}
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                This errand is no longer active. You can book a new one anytime.
              </Text>
              <View className="mt-5 w-full">
                <Button
                  title="Back to home"
                  onPress={() => router.replace('/(customer)/(tabs)')}
                  fullWidth
                />
              </View>
            </>
          )}
        </View>
      </SafeAreaView>

      {overlays}
    </View>
  );
}

const cs = StyleSheet.create({
  // Wallet glyph on the "Waiting for your payment" card — same 64pt disc and
  // soft brand wash as the app's other status discs.
  payBadge: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sized box the pickup pin's search radar fills — RunnerSearchAnimation is
  // absolute-fill, so it needs a fixed parent, anchored on the pickup coord.
  searchPulse: {
    width: 150,
    height: 150,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  // Visually hidden but still announced by screen readers.
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: LightColors.surface,
    // 28 top radius matches the app's sheet chrome (BottomSheet /
    // ExpandableSheet); bottom padding is composed at the call site so
    // it can absorb the safe-area inset.
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 24,
    ...Elevation.lg,
    shadowOffset: { width: 0, height: -10 },
  },
});
