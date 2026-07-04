import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircle, XCircle } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useBookingStore } from '../../../stores/bookingStore';
import { useBookingStatus } from '../../../hooks/useBookingStatus';
import { useBackGuard } from '../../../hooks/useBackGuard';
import { useForegroundInterval } from '../../../hooks/useForegroundInterval';
import { bookingService } from '../../../services/booking.service';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import type { BookingStatus } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { LightColors, Elevation } from '../../../constants/colors';


const PULSE_SIZE = 200;

type SearchState = 'searching' | 'matched' | 'no_runner' | 'cancelled';

/* ─── Animated pulse rings ─── */
function PulseRing({ delay }: { delay: number }) {
  const scale = useSharedValue(0.3);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    const timeout = setTimeout(() => {
      scale.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
      opacity.value = withRepeat(
        withTiming(0, { duration: 2000, easing: Easing.out(Easing.ease) }),
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
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: PULSE_SIZE,
          height: PULSE_SIZE,
          borderRadius: PULSE_SIZE / 2,
          borderWidth: 2,
          borderColor: LightColors.primary,
          backgroundColor: `${LightColors.primary}14`,
        },
        style,
      ]}
    />
  );
}

function PulseOverlay() {
  return (
    <View style={cs.pulseContainer} pointerEvents="none">
      <PulseRing delay={0} />
      <PulseRing delay={700} />
      <PulseRing delay={1400} />
      {/* Center dot */}
      <View style={cs.centerDot} />
    </View>
  );
}

export default function ConfirmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
  const draftBooking = useBookingStore((s) => s.draftBooking);

  const bookingId = params.bookingId ?? activeBooking?.id;
  const [state, setState] = useState<SearchState>('searching');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  // Tracks how many widened-radius retries the customer has used so the
  // server keeps fanning the search out instead of repeating the same one.
  const [retryStep, setRetryStep] = useState<1 | 2 | 3>(1);
  const [isRetrying, setIsRetrying] = useState(false);
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
        setTimeout(() => {
          if (bookingId) router.replace(`/(customer)/tracking/${bookingId}`);
        }, 1200);
      } else if (status === 'cancelled') {
        setState('cancelled');
        setActiveBooking(null);
      } else if ((status as string) === 'no_runner') {
        setState('no_runner');
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
    try {
      const res = await bookingService.getBooking(bookingId);
      reactToStatus(res.data.data);
    } catch {
      // ignore — realtime will catch up
    }
  }, [bookingId, reactToStatus]);
  useForegroundInterval(
    pollSafetyNet,
    30000,
    !!bookingId && state === 'searching',
    false, // skip immediate run — reactToStatus already fires from realtime
  );

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

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const ss = (secondsLeft % 60).toString().padStart(2, '0');
  const progress = Math.max(0, Math.min(1, secondsLeft / totalSeconds));

  return (
    <View style={{ flex: 1 }}>
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

      {/* Pulse overlay centered on screen */}
      {state === 'searching' && <PulseOverlay />}

      {/* Bottom card */}
      <SafeAreaView style={cs.overlay} edges={['top', 'bottom']}>
        <View style={{ flex: 1 }} />
        <View style={cs.card}>
          {state === 'searching' && (
            <>
              <Text className="text-xl font-montserrat-bold text-textPrimary text-center">
                Looking for a runner nearby...
              </Text>
              {activeBooking?.pricing_mode === 'negotiate' && (
                <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                  Your offer is visible to runners
                </Text>
              )}

              {/* Countdown */}
              <View style={cs.countdownWrap}>
                <Text style={cs.countdownTime}>{mm}:{ss}</Text>
                <Text style={cs.countdownLabel}>
                  {activeBooking?.pricing_mode === 'negotiate'
                    ? 'Time left for runners to accept your offer'
                    : 'Time left to find a runner'}
                </Text>
                <View style={cs.progressTrack}>
                  <View style={[cs.progressFill, { width: `${progress * 100}%` }]} />
                </View>
              </View>

              {bookingNumber ? (
                <Text className="text-xs font-montserrat text-textTertiary mt-2 text-center">
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
              <CheckCircle size={48} color={LightColors.success} style={{ alignSelf: 'center' }} />
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                Runner Found!
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                Redirecting to tracking...
              </Text>
            </>
          )}

          {state === 'no_runner' && (
            <>
              <XCircle size={48} color={LightColors.warning} style={{ alignSelf: 'center' }} />
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                No runners available
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                {retryStep === 1
                  ? 'No runners are nearby right now. We can widen the search area.'
                  : retryStep === 2
                    ? 'Still no luck. We can search a much larger area, but ETA will be longer.'
                    : "We've already searched a wide area. Try cancelling and rebooking later, or switch pricing modes."}
              </Text>
              <View className="mt-5 w-full gap-3">
                {retryStep <= 3 && (
                  <Button
                    title={
                      isRetrying
                        ? 'Searching…'
                        : retryStep === 1
                          ? 'Search again'
                          : retryStep === 2
                            ? 'Widen search area'
                            : 'Search a wider area'
                    }
                    onPress={handleRetry}
                    disabled={isRetrying}
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
        title="Cancel Booking"
        message="No fee will be charged — a runner hasn't accepted yet."
        confirmLabel="Yes, Cancel"
        cancelLabel="No, Keep"
        destructive
        loading={isCancelling}
        onConfirm={handleConfirmCancel}
        onCancel={() => setShowCancelModal(false)}
      />
    </View>
  );
}

const cs = StyleSheet.create({
  pulseContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: LightColors.primary,
    borderWidth: 3,
    borderColor: LightColors.surface,
    elevation: 4,
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    backgroundColor: LightColors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    ...Elevation.lg,
    shadowOffset: { width: 0, height: -10 },
  },
  countdownWrap: {
    marginTop: 18,
    alignItems: 'center',
  },
  countdownTime: {
    fontSize: 36,
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
