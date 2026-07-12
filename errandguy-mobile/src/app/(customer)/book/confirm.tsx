import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StatusBar,
  StyleSheet,
  AppState,
  AccessibilityInfo,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SearchX, XCircle } from 'lucide-react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useBookingStore } from '../../../stores/bookingStore';
import { useBookingStatus } from '../../../hooks/useBookingStatus';
import { useBackGuard } from '../../../hooks/useBackGuard';
import { useForegroundInterval } from '../../../hooks/useForegroundInterval';
import { useSmartPolling } from '../../../hooks/useSmartPolling';
import { bookingService } from '../../../services/booking.service';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { SuccessCheck } from '../../../components/ui/SuccessCheck';
import { RunnerSearchAnimation } from '../../../components/customer/RunnerSearchAnimation';
import type { BookingStatus } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { LightColors, Elevation } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';


type SearchState = 'searching' | 'matched' | 'no_runner' | 'cancelled';

// Rotating reassurance copy while searching — cycled every ~5s so a
// longer wait never reads as a frozen screen.
const SEARCHING_LINES = [
  'Contacting nearby runners…',
  'Hang tight — finding your best match…',
  'Still searching — good runners are worth the wait…',
] as const;

// Screen-reader announcements for each state transition.
const STATE_ANNOUNCEMENTS: Record<SearchState, string> = {
  searching: 'Searching for a runner nearby',
  matched: 'Runner found. Redirecting to tracking.',
  no_runner: 'No runners available right now.',
  cancelled: 'Booking cancelled.',
};

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
  const [state, setState] = useState<SearchState>('searching');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  // Tracks how many widened-radius retries the customer has used so the
  // server keeps fanning the search out instead of repeating the same one.
  const [retryStep, setRetryStep] = useState<1 | 2 | 3>(1);
  const [isRetrying, setIsRetrying] = useState(false);
  // True once a widest-radius (step 3) retry has also timed out — at that
  // point another identical retry would just be theatre, so the UI swaps
  // to a rebook path instead.
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
      toast.error('Booking session lost. Please try again.');
      router.replace('/(customer)/(tabs)');
    }
  }, [bookingId, router]);

  // Countdown until we give up waiting for a runner.
  // Fixed price → 60s (matches matching window). Negotiate → 5 minutes (per spec).
  const totalSeconds = activeBooking?.pricing_mode === 'negotiate' ? 300 : 60;
  // Deadline-based countdown so backgrounding the app doesn't pause it
  // (the *server* doesn't pause matching either — pretending it does
  // gives users a stale impression). Recompute every tick from
  // `Date.now()` against this deadline.
  const deadlineRef = useRef<number>(Date.now() + totalSeconds * 1000);
  // Reset deadline when the screen first mounts for a given totalSeconds.
  // (Subsequent retries call `setDeadline` directly.)
  const initialisedDeadlineRef = useRef(false);
  if (!initialisedDeadlineRef.current) {
    deadlineRef.current = Date.now() + totalSeconds * 1000;
    initialisedDeadlineRef.current = true;
  }
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);

  // Cold-start / deep-link hydration (e.g. returning from the Xendit
  // checkout after the app was killed): the store has no activeBooking,
  // so `totalSeconds` above guessed the fixed-price 60s window and the
  // realtime merge can't hydrate a null store. Fetch the booking now
  // rather than waiting up to 30s for the safety-net poll.
  const hydratingRef = useRef(false);
  useEffect(() => {
    if (!bookingId || activeBooking?.id === bookingId || hydratingRef.current) {
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
  }, [bookingId, activeBooking?.id, setActiveBooking]);

  // Re-seed the countdown once the *real* booking arrives (from the fetch
  // above, realtime, or the AppState resync) so a negotiate booking never
  // runs against the guessed 60s deadline — the visible timer and the
  // progressbar's accessibilityValue must stay truthful. Keyed by booking
  // id so ordinary status updates of the same booking don't reset it.
  const seededForRef = useRef<string | null>(
    activeBooking?.id === bookingId ? (bookingId ?? null) : null,
  );
  useEffect(() => {
    if (!bookingId || activeBooking?.id !== bookingId) return;
    if (seededForRef.current === bookingId) return;
    seededForRef.current = bookingId;
    if (state !== 'searching') return;
    const total = activeBooking.pricing_mode === 'negotiate' ? 300 : 60;
    let deadline = Date.now() + total * 1000;
    // Negotiate bookings expose the server's own expiry — prefer it so
    // the timer reflects time already spent matching while we were away.
    if (activeBooking.pricing_mode === 'negotiate' && activeBooking.negotiate_expires_at) {
      const serverDeadline = Date.parse(activeBooking.negotiate_expires_at);
      if (Number.isFinite(serverDeadline) && serverDeadline > Date.now()) {
        deadline = serverDeadline;
      }
    }
    deadlineRef.current = deadline;
    setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  }, [activeBooking, bookingId, state]);

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
    if (state === 'no_runner') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
    } else if (state === 'cancelled') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    AccessibilityInfo.announceForAccessibility(STATE_ANNOUNCEMENTS[state]);
  }, [state]);

  // Get pickup coords from booking or draft.
  // IMPORTANT: Laravel casts decimal columns to strings (e.g. "8.94120787");
  // Mapbox.Camera.centerCoordinate decodes via Codable as Double and silently
  // falls back to the globe view when it sees a string. Coerce with Number().
  // Countdown ticker — only runs while we're still searching.
  // Uses `useForegroundInterval` so the timer pauses when the app is
  // backgrounded. The deadline is wall-clock based, so on resume we
  // immediately recompute against `Date.now()` and account for any
  // elapsed-while-suspended seconds in a single tick — no drift, no
  // "frozen counter" UX, no double timeout.
  const tickCountdown = useCallback(() => {
    const remaining = Math.max(
      0,
      Math.ceil((deadlineRef.current - Date.now()) / 1000),
    );
    setSecondsLeft(remaining);
    if (remaining <= 0) {
      setState('no_runner');
      if (retriedAtMaxRef.current) setExhausted(true);
    }
  }, []);
  useForegroundInterval(tickCountdown, 1000, state === 'searching');

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
    state === 'searching',
    'Tap back again to leave — your booking will keep searching.',
  );

  // ── Realtime status updates ──
  // Subscribes to Supabase Realtime; reacts to status transitions instantly
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
        setState('cancelled');
        setActiveBooking(null);
      } else if ((status as string) === 'no_runner') {
        setState('no_runner');
        if (retriedAtMaxRef.current) setExhausted(true);
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

  const handleCancel = useCallback(() => {
    setShowCancelModal(true);
  }, []);

  const handleConfirmCancel = useCallback(async () => {
    if (!bookingId) return;
    setIsCancelling(true);
    try {
      await bookingService.cancelBooking(bookingId, 'Customer cancelled');
      setState('cancelled');
      setActiveBooking(null);
      setShowCancelModal(false);
      // Navigation preempts the cancelled-state render, so close the loop
      // here — the modal just promised "no fee", confirm it happened.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      toast.success('Booking cancelled — no fee charged.');
      router.replace('/(customer)/(tabs)');
    } catch {
      toast.error('Failed to cancel booking');
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
      await bookingService.retryMatch(bookingId, step);
      // A widest-radius attempt is in flight — if this one also times
      // out, the next no_runner is terminal (see `exhausted`).
      if (step === 3) retriedAtMaxRef.current = true;
      setRetryStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : 3));
      // Reset the deadline-based countdown.
      deadlineRef.current = Date.now() + totalSeconds * 1000;
      setSecondsLeft(totalSeconds);
      setState('searching');
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message ??
          'Could not retry matching right now. Try again in a moment.',
      );
    } finally {
      setIsRetrying(false);
    }
  }, [bookingId, isRetrying, retryStep, totalSeconds]);

  // Terminal no_runner recovery: the draft was cleared at submit, so
  // "rebook" would otherwise mean full re-entry. Re-seed the draft from
  // the failed booking and drop the user on the review step where the
  // details that matter for matching (vehicle, pricing mode, offer) are
  // editable.
  const handleRebook = useCallback(() => {
    const b = activeBooking;
    if (!b) {
      router.replace('/(customer)/book/type');
      return;
    }
    // Server clocks may have moved past a scheduled slot while we
    // searched — a stale scheduled_at would just 422 at resubmit.
    const scheduledAt = b.scheduled_at ? Date.parse(b.scheduled_at) : NaN;
    const scheduleStillValid =
      b.schedule_type === 'scheduled' &&
      Number.isFinite(scheduledAt) &&
      scheduledAt > Date.now();
    clearDraft();
    updateDraft({
      errand_type_id: b.errand_type_id,
      errand_type_slug: b.errand_type?.slug,
      pickup_address: b.pickup_address,
      // Laravel casts decimal columns to strings — coerce so downstream
      // consumers (estimate payload, map cameras) see real numbers.
      pickup_lat: Number(b.pickup_lat),
      pickup_lng: Number(b.pickup_lng),
      pickup_contact_name: b.pickup_contact_name ?? undefined,
      pickup_contact_phone: b.pickup_contact_phone ?? undefined,
      dropoff_address: b.dropoff_address ?? undefined,
      dropoff_lat: b.dropoff_lat != null ? Number(b.dropoff_lat) : undefined,
      dropoff_lng: b.dropoff_lng != null ? Number(b.dropoff_lng) : undefined,
      dropoff_contact_name: b.dropoff_contact_name ?? undefined,
      dropoff_contact_phone: b.dropoff_contact_phone ?? undefined,
      description: b.description ?? undefined,
      special_instructions: b.special_instructions ?? undefined,
      estimated_item_value: b.estimated_item_value ?? undefined,
      shopping_budget: b.shopping_budget ?? undefined,
      shoppingItems: b.shopping_items?.length
        ? b.shopping_items.map((it) => ({
            id: it.id,
            name: it.name,
            qty: it.qty ?? 1,
          }))
        : undefined,
      pricing_mode: b.pricing_mode,
      vehicle_type_rate: b.vehicle_type_rate ?? undefined,
      customer_offer: b.customer_offer != null ? Number(b.customer_offer) : undefined,
      schedule_type: scheduleStillValid ? 'scheduled' : 'now',
      scheduled_at: scheduleStillValid ? b.scheduled_at ?? undefined : undefined,
    });
    setStep(3);
    setActiveBooking(null);
    router.replace('/(customer)/book/review');
  }, [activeBooking, clearDraft, updateDraft, setStep, setActiveBooking, router]);

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const ss = (secondsLeft % 60).toString().padStart(2, '0');
  const progress = Math.max(0, Math.min(1, secondsLeft / totalSeconds));

  return (
    <View style={{ flex: 1 }}>
      {/* The whole screen is the dark brand gradient — status-bar icons
          must be light or they vanish against #1E40AF. Mounting last in
          the stack, this wins over the soft headers below and pops back
          off when the screen unmounts. */}
      <StatusBar barStyle="light-content" />
      {/* Static brand backdrop — the "searching" screen used to render a live
          map behind the pulse, which streamed billed HERE tiles for the whole
          wait. A gradient reads the same and costs nothing. The live map opens
          on demand later, on the tracking screen. */}
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

      {/* Bottom card */}
      <SafeAreaView style={cs.overlay} edges={['top']}>
        {/* Pulse lives inside the spacer so it centers in the free area
            ABOVE the card — centered on the full screen, the bottom of
            the 200pt ring hides behind the card on SE-height phones. */}
        <View style={{ flex: 1 }}>
          {state === 'searching' && <RunnerSearchAnimation />}
        </View>
        {/* Polite live region (Android) — mirrors the iOS announce call in
            the state-transition effect so screen readers hear searching →
            matched / no_runner / cancelled without focus moving. */}
        <Text
          accessibilityLiveRegion="polite"
          style={cs.srOnly}
          importantForAccessibility="yes"
        >
          {STATE_ANNOUNCEMENTS[state]}
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
          {state === 'searching' && (
            <>
              <Text className="text-xl font-montserrat-bold text-textPrimary text-center">
                Looking for a runner nearby…
              </Text>
              {/* Rotating reassurance line — cycles every ~5s. Two lines
                  of height are reserved so the card (and the pulse
                  centered above it) doesn't jump when a longer line
                  wraps on narrow phones. */}
              <Text
                className="text-sm font-montserrat text-textSecondary mt-1 text-center"
                style={{ minHeight: 36 }}
              >
                {SEARCHING_LINES[searchLineIdx]}
              </Text>
              {activeBooking?.pricing_mode === 'negotiate' && (
                <Text className="text-xs font-montserrat text-textTertiary mt-1 text-center">
                  Your offer is visible to runners
                </Text>
              )}

              {/* Countdown */}
              <View
                style={cs.countdownWrap}
                accessibilityRole="progressbar"
                accessibilityLabel={
                  activeBooking?.pricing_mode === 'negotiate'
                    ? 'Time left for runners to accept your offer'
                    : 'Time left to find a runner'
                }
                accessibilityValue={{
                  min: 0,
                  max: totalSeconds,
                  now: secondsLeft,
                  text: `${mm}:${ss} remaining`,
                }}
              >
                <Text
                  style={[
                    cs.countdownTime,
                    // Telegraph the timeout before the hard cut to
                    // no_runner — the numeric timer carries the meaning,
                    // color reinforces it.
                    secondsLeft <= 10 && { color: LightColors.warningDark },
                  ]}
                >
                  {mm}:{ss}
                </Text>
                <Text style={cs.countdownLabel}>
                  {activeBooking?.pricing_mode === 'negotiate'
                    ? 'Time left for runners to accept your offer'
                    : 'Time left to find a runner'}
                </Text>
                <View style={cs.progressTrack}>
                  <View
                    style={[
                      cs.progressFill,
                      { width: `${progress * 100}%` },
                      secondsLeft <= 10 && {
                        backgroundColor: LightColors.warning,
                      },
                    ]}
                  />
                </View>
              </View>

              {bookingNumber ? (
                // Inter for the booking number — data-dense identifiers
                // use the numeric face per the type convention.
                <Text className="text-xs font-inter text-textTertiary mt-2 text-center">
                  Booking: {bookingNumber}
                </Text>
              ) : null}
              <View className="mt-5 w-full">
                <Button
                  title="Cancel Booking"
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
              {/* SuccessCheck fires its own success haptic on mount. */}
              <View style={{ alignSelf: 'center' }}>
                <SuccessCheck celebrate size={88} />
              </View>
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                Runner Found!
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                Redirecting to tracking…
              </Text>
            </>
          )}

          {state === 'no_runner' && (
            <>
              {/* SearchX, not XCircle — "no match found" and "cancelled"
                  must be distinguishable by glyph, not color alone. */}
              <SearchX size={48} color={LightColors.warning} style={{ alignSelf: 'center' }} />
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                No runners available
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                {exhausted
                  ? 'We searched our widest area and no runner picked this up. Rebooking with different details — vehicle, pricing, or timing — gives the best chance.'
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
                ) : (
                  <Button
                    title={
                      retryStep === 1
                        ? 'Search again'
                        : retryStep === 2
                          ? 'Widen search area'
                          : 'Search widest area'
                    }
                    onPress={handleRetry}
                    loading={isRetrying}
                    loadingTitle="Searching…"
                    fullWidth
                  />
                )}
                <Button
                  title="Go Home"
                  variant="outline"
                  onPress={() => router.replace('/(customer)/(tabs)')}
                  fullWidth
                />
              </View>
            </>
          )}

          {state === 'cancelled' && (
            <>
              <XCircle size={48} color={LightColors.danger} style={{ alignSelf: 'center' }} />
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                Booking Cancelled
              </Text>
              {/* This card only shows for a server-side cancellation —
                  a customer cancel navigates home directly. */}
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                This booking is no longer active. You can start a new one anytime.
              </Text>
              <View className="mt-5 w-full">
                <Button
                  title="Go Home"
                  onPress={() => router.replace('/(customer)/(tabs)')}
                  fullWidth
                />
              </View>
            </>
          )}
        </View>
      </SafeAreaView>

      <ConfirmModal
        visible={showCancelModal}
        title="Cancel this booking?"
        message="No fee will be charged — a runner hasn't accepted yet."
        confirmLabel="Cancel booking"
        confirmLoadingLabel="Cancelling…"
        cancelLabel="Keep searching"
        destructive
        loading={isCancelling}
        onConfirm={handleConfirmCancel}
        onCancel={() => setShowCancelModal(false)}
      />
    </View>
  );
}

const cs = StyleSheet.create({
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
  countdownWrap: {
    marginTop: 20,
    alignItems: 'center',
  },
  countdownTime: {
    // Display rung (4xl) — the timer is this card's hero number.
    fontSize: 34,
    fontFamily: 'Inter_600SemiBold',
    color: LightColors.textPrimary,
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  countdownLabel: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textTertiary,
    marginTop: 4,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: LightColors.divider,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: LightColors.primary,
    borderRadius: 3,
  },
});
