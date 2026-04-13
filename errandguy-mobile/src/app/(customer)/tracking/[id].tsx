import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  MessageCircle,
  Phone,
  Share2,
  Shield,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { useBookingStore } from '../../../stores/bookingStore';
import { bookingService } from '../../../services/booking.service';
import { useRunnerTracking } from '../../../hooks/useRunnerTracking';
import { TrackingSkeleton } from '../../../components/ui/Skeleton';
import { Avatar } from '../../../components/ui/Avatar';
import { RatingStars } from '../../../components/ui/RatingStars';
import { StatusTimeline } from '../../../components/ui/StatusTimeline';
import { Button } from '../../../components/ui/Button';
import { formatTime } from '../../../utils/formatDate';
import { STATUS_LABELS } from '../../../constants/statusLabels';
import type { Booking, BookingStatus, BookingStatusLog } from '../../../types';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

const STANDARD_STEPS: BookingStatus[] = [
  'pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup',
  'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered', 'completed',
];

const TRANSPORT_STEPS: BookingStatus[] = [
  'pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup',
  'picked_up', 'in_transit', 'arrived_at_dropoff', 'completed',
];

const CAN_CANCEL_STATUSES: BookingStatus[] = [
  'pending', 'matched', 'accepted', 'heading_to_pickup',
];

export default function TrackingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setActiveBooking } = useBookingStore();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [statusLogs, setStatusLogs] = useState<BookingStatusLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sosActive, setSosActive] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);

  // Live runner location via Supabase Realtime
  const { runnerLocation, isConnected } = useRunnerTracking(
    booking?.runner_id ? (id ?? null) : null,
  );

  // Fetch booking data
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      bookingService.getBooking(id),
      bookingService.trackBooking(id),
    ])
      .then(([bookingRes, trackRes]) => {
        const b = bookingRes.data.data;
        setBooking(b);
        setActiveBooking(b);
        setStatusLogs(trackRes.data.data?.status_logs ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, setActiveBooking]);

  // Fetch route line
  useEffect(() => {
    if (!booking || !MAPBOX_TOKEN) return;
    const { pickup_lng, pickup_lat, dropoff_lng, dropoff_lat } = booking;
    if (!pickup_lng || !pickup_lat || !dropoff_lng || !dropoff_lat) return;

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const coords = data.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(coords)) setRouteCoords(coords);
      })
      .catch(() => {});
  }, [booking]);

  // Poll for booking status updates
  useEffect(() => {
    if (!id) return;
    pollRef.current = setInterval(async () => {
      try {
        const [bookingRes, trackRes] = await Promise.all([
          bookingService.getBooking(id),
          bookingService.trackBooking(id),
        ]);
        const b = bookingRes.data.data;
        setBooking(b);
        setActiveBooking(b);
        setStatusLogs(trackRes.data.data?.status_logs ?? []);
        if (b?.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          router.replace(`/(customer)/rate/${id}`);
        }
      } catch {}
    }, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id, router, setActiveBooking]);

  // Route GeoJSON
  const routeGeoJSON = useMemo(() => {
    if (routeCoords.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: routeCoords },
    };
  }, [routeCoords]);

  // Camera bounds covering pickup, dropoff, and runner
  const cameraBounds = useMemo(() => {
    if (!booking) return undefined;
    const points: [number, number][] = [];
    if (booking.pickup_lng && booking.pickup_lat) {
      points.push([booking.pickup_lng, booking.pickup_lat]);
    }
    if (booking.dropoff_lng && booking.dropoff_lat) {
      points.push([booking.dropoff_lng, booking.dropoff_lat]);
    }
    if (runnerLocation) {
      points.push([runnerLocation.lng, runnerLocation.lat]);
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
  }, [booking, runnerLocation]);

  const handleCancel = useCallback(() => {
    if (!id) return;
    Alert.alert('Cancel Booking', 'Are you sure you want to cancel?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await bookingService.cancelBooking(id);
            setActiveBooking(null);
            router.replace('/(customer)/(tabs)');
          } catch {
            Alert.alert('Error', 'Failed to cancel booking');
          }
        },
      },
    ]);
  }, [id, setActiveBooking, router]);

  const handleSOS = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Emergency SOS',
      'This will alert your trusted contacts and our support team. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm SOS',
          style: 'destructive',
          onPress: async () => {
            try {
              await bookingService.triggerSOS(id);
              setSosActive(true);
            } catch {
              Alert.alert('Error', 'Failed to trigger SOS');
            }
          },
        },
      ],
    );
  }, [id]);

  const handleCall = useCallback(() => {
    Alert.alert('Call Runner', 'Phone call feature coming soon');
  }, []);

  const handleShareTrip = useCallback(async () => {
    if (!id) return;
    try {
      await bookingService.shareTrip(id);
      Alert.alert('Trip Shared', 'Trip sharing link has been generated');
    } catch {
      Alert.alert('Error', 'Failed to share trip');
    }
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <TrackingSkeleton />
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-8">
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Booking not found
        </Text>
        <View className="mt-4">
          <Button title="Go Home" onPress={() => router.replace('/(customer)/(tabs)')} />
        </View>
      </SafeAreaView>
    );
  }

  const isTransportation = booking.is_transportation;
  const steps = isTransportation ? TRANSPORT_STEPS : STANDARD_STEPS;
  const currentStatusIndex = steps.indexOf(booking.status);
  const canCancel = CAN_CANCEL_STATUSES.includes(booking.status);

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

  const mapCenter: [number, number] = booking.pickup_lng && booking.pickup_lat
    ? [booking.pickup_lng, booking.pickup_lat]
    : [121.0, 14.6]; // Manila default

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header (absolute over map) */}
      <View className="absolute top-0 left-0 right-0 z-10">
        <SafeAreaView edges={['top']}>
          <View className="flex-row items-center px-5 py-2">
            <Pressable
              onPress={() => router.back()}
              className="w-10 h-10 rounded-full bg-white/90 items-center justify-center mr-3 shadow-sm"
            >
              <ArrowLeft size={20} color="#0F172A" />
            </Pressable>
            <View className="flex-1 bg-white/90 rounded-full px-4 py-2 shadow-sm">
              <Text className="text-sm font-montserrat-bold text-textPrimary" numberOfLines={1}>
                {STATUS_LABELS[booking.status]}
              </Text>
              <Text className="text-[10px] font-montserrat text-textSecondary">
                {booking.booking_number}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* Live Map */}
      <View className="h-[45%]">
        <Mapbox.MapView
          style={{ flex: 1 }}
          styleURL={Mapbox.StyleURL.Street}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
        >
          <Mapbox.Camera
            ref={cameraRef}
            {...(cameraBounds
              ? { bounds: cameraBounds }
              : { centerCoordinate: mapCenter, zoomLevel: 14 }
            )}
            animationDuration={1000}
          />

          {/* Pickup marker */}
          {booking.pickup_lng && booking.pickup_lat && (
            <Mapbox.PointAnnotation
              id="pickup"
              coordinate={[booking.pickup_lng, booking.pickup_lat]}
            >
              <View className="items-center">
                <View className="w-8 h-8 rounded-full bg-primary items-center justify-center border-2 border-white shadow-md">
                  <Text className="text-white text-[10px] font-montserrat-bold">P</Text>
                </View>
              </View>
            </Mapbox.PointAnnotation>
          )}

          {/* Dropoff marker */}
          {booking.dropoff_lng && booking.dropoff_lat && (
            <Mapbox.PointAnnotation
              id="dropoff"
              coordinate={[booking.dropoff_lng, booking.dropoff_lat]}
            >
              <View className="items-center">
                <View className="w-8 h-8 rounded-full bg-danger items-center justify-center border-2 border-white shadow-md">
                  <Text className="text-white text-[10px] font-montserrat-bold">D</Text>
                </View>
              </View>
            </Mapbox.PointAnnotation>
          )}

          {/* Runner marker (moving) */}
          {runnerLocation && (
            <Mapbox.MarkerView
              id="runner"
              coordinate={[runnerLocation.lng, runnerLocation.lat]}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View className="items-center">
                <View className="w-10 h-10 rounded-full bg-success items-center justify-center border-3 border-white shadow-lg">
                  <Text className="text-white text-xs font-montserrat-bold">🏃</Text>
                </View>
                {runnerLocation.speed != null && runnerLocation.speed > 0 && (
                  <View className="bg-black/70 rounded-full px-2 py-0.5 mt-1">
                    <Text className="text-white text-[8px] font-montserrat">
                      {(runnerLocation.speed * 3.6).toFixed(0)} km/h
                    </Text>
                  </View>
                )}
              </View>
            </Mapbox.MarkerView>
          )}

          {/* Route line */}
          {routeGeoJSON && (
            <Mapbox.ShapeSource id="routeLine" shape={routeGeoJSON}>
              <Mapbox.LineLayer
                id="routeLineLayer"
                style={{
                  lineColor: '#2563EB',
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </Mapbox.ShapeSource>
          )}
        </Mapbox.MapView>

        {/* Realtime indicator */}
        {booking.runner_id && (
          <View className="absolute bottom-3 right-3 flex-row items-center bg-white/90 rounded-full px-3 py-1.5 shadow-sm">
            <View className={`w-2 h-2 rounded-full mr-1.5 ${isConnected ? 'bg-success' : 'bg-gray-400'}`} />
            <Text className="text-[10px] font-montserrat text-textSecondary">
              {isConnected ? 'Live' : 'Connecting...'}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom Panel */}
      <ScrollView className="flex-1 px-5 pt-4" showsVerticalScrollIndicator={false}>
        {/* Transportation PIN */}
        {isTransportation && booking.ride_pin && (
          <View className="bg-warning/10 border border-warning rounded-xl p-4 mb-4 items-center">
            <Text className="text-xs font-montserrat text-warning mb-1">
              Show this PIN to your runner
            </Text>
            <Text className="text-3xl font-montserrat-bold text-warning tracking-widest">
              {booking.ride_pin}
            </Text>
          </View>
        )}

        {/* Runner Info */}
        {booking.runner_id && (
          <View className="flex-row items-center mb-4">
            <Avatar size="md" />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-montserrat-bold text-textPrimary">Runner</Text>
              <RatingStars value={4.5} size={14} readonly />
            </View>
            <View className="flex-row gap-3">
              <Pressable
                className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center"
                onPress={() => router.push(`/(customer)/chat/${booking.id}`)}
              >
                <MessageCircle size={18} color="#2563EB" />
              </Pressable>
              <Pressable
                className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center"
                onPress={handleCall}
              >
                <Phone size={18} color="#2563EB" />
              </Pressable>
              <Pressable
                className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center"
                onPress={handleShareTrip}
              >
                <Share2 size={18} color="#2563EB" />
              </Pressable>
            </View>
          </View>
        )}

        {/* Status Timeline */}
        <StatusTimeline steps={timelineSteps} />

        {/* Bottom Actions */}
        <View className="pb-6 pt-4 gap-2">
          {isTransportation && !sosActive && (
            <Button
              title="Emergency SOS"
              variant="danger"
              icon={Shield}
              onPress={handleSOS}
              fullWidth
            />
          )}
          {sosActive && (
            <View className="bg-danger/10 border border-danger rounded-xl p-3 items-center">
              <Text className="text-sm font-montserrat-bold text-danger">
                SOS Active — Help is on the way
              </Text>
            </View>
          )}
          {canCancel && (
            <Button title="Cancel Errand" variant="outline" onPress={handleCancel} fullWidth />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
