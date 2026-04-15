import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
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
import Mapbox from '@rnmapbox/maps';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import type { BookingStatus } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { MAP_STYLE_URL } from '../../../constants/map';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
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
          borderColor: '#2563EB',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
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
  const { activeBooking, setActiveBooking, draftBooking } = useBookingStore();

  const bookingId = params.bookingId ?? activeBooking?.id;
  const [state, setState] = useState<SearchState>('searching');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [bookingNumber, setBookingNumber] = useState(
    activeBooking?.booking_number ?? '',
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get pickup coords from booking or draft
  const pickupLng = activeBooking?.pickup_lng ?? draftBooking?.pickup_lng ?? 121.0;
  const pickupLat = activeBooking?.pickup_lat ?? draftBooking?.pickup_lat ?? 14.6;
  const center: [number, number] = [pickupLng, pickupLat];

  // Poll for status updates
  useEffect(() => {
    if (!bookingId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await bookingService.getBooking(bookingId);
        const booking = res.data.data;
        if (!booking) return;

        setBookingNumber(booking.booking_number);
        const status: BookingStatus = booking.status;

        if (
          status === 'matched' ||
          status === 'accepted' ||
          status === 'heading_to_pickup'
        ) {
          setState('matched');
          setActiveBooking(booking);
          setTimeout(() => {
            router.replace(`/(customer)/tracking/${bookingId}`);
          }, 2000);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (status === 'cancelled') {
          setState('cancelled');
          setActiveBooking(null);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Silently retry
      }
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [bookingId, router, setActiveBooking]);

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
      if (pollRef.current) clearInterval(pollRef.current);
      setShowCancelModal(false);
      router.replace('/(customer)/(tabs)');
    } catch {
      toast.error('Failed to cancel booking');
    } finally {
      setIsCancelling(false);
    }
  }, [bookingId, setActiveBooking, router]);

  return (
    <View style={{ flex: 1 }}>
      {/* Background Map */}
      <Mapbox.MapView
        style={StyleSheet.absoluteFill}
        styleURL={MAP_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        scrollEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        zoomEnabled={false}
      >
        <Mapbox.Camera
          centerCoordinate={center}
          zoomLevel={14}
          animationMode="none"
        />
      </Mapbox.MapView>

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
                  fullWidth
                />
              </View>
            </>
          )}

          {state === 'matched' && (
            <>
              <CheckCircle size={48} color="#22C55E" style={{ alignSelf: 'center' }} />
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
              <XCircle size={48} color="#F59E0B" style={{ alignSelf: 'center' }} />
              <Text className="text-xl font-montserrat-bold text-textPrimary mt-4 text-center">
                No runners available
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-1 text-center">
                Try again in a few minutes
              </Text>
              <View className="mt-5 w-full gap-3">
                <Button title="Try Again" onPress={() => setState('searching')} fullWidth />
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
              <XCircle size={48} color="#EF4444" style={{ alignSelf: 'center' }} />
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
        message="Are you sure you want to cancel this booking?"
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
    backgroundColor: '#2563EB',
    borderWidth: 3,
    borderColor: '#fff',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
});
