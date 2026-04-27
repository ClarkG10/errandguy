import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
  Linking,
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
import { useChatStore } from '../../../stores/chatStore';
import { bookingService } from '../../../services/booking.service';
import { useRunnerTracking } from '../../../hooks/useRunnerTracking';
import { useBookingStatus } from '../../../hooks/useBookingStatus';
import { TrackingSkeleton } from '../../../components/ui/Skeleton';
import { Avatar } from '../../../components/ui/Avatar';
import { RatingStars } from '../../../components/ui/RatingStars';
import { StatusTimeline } from '../../../components/ui/StatusTimeline';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { ExpandableSheet } from '../../../components/ui/ExpandableSheet';
import { formatTime } from '../../../utils/formatDate';
import { formatCurrency } from '../../../utils/formatCurrency';
import { STATUS_LABELS } from '../../../constants/statusLabels';
import { MAP_STYLE_URL } from '../../../constants/map';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import type { Booking, BookingStatus, BookingStatusLog } from '../../../types';
import { toast } from '../../../stores/toastStore';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

const CAN_CANCEL_STATUSES: BookingStatus[] = [
  'pending', 'matched', 'accepted', 'heading_to_pickup',
];

export default function TrackingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setActiveBooking } = useBookingStore();
  const refreshUnread = useChatStore((s) => s.refreshUnread);
  const unreadForBooking = useChatStore(
    (s) => (id ? s.unreadByBooking[id] ?? 0 : 0),
  );

  const [booking, setBooking] = useState<Booking | null>(null);
  const [statusLogs, setStatusLogs] = useState<BookingStatusLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sosActive, setSosActive] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelPreview, setCancelPreview] = useState<{
    fee: number;
    tier: 'free' | 'flat' | 'percentage';
    reason: string;
    cancellable: boolean;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showSOSModal, setShowSOSModal] = useState(false);
  const cameraRef = useRef<Mapbox.Camera>(null);

  // Live runner location via Supabase Realtime
  const { runnerLocation, isConnected } = useRunnerTracking(
    booking?.runner_id ? (id ?? null) : null,
  );

  // Live booking status updates via Supabase Realtime
  const { isConnected: statusConnected } = useBookingStatus(id ?? null);

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

  // Poll chat unread counts every 15s while on the tracking screen so the
  // chat badge updates without a websocket. Refresh once on mount too.
  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 15000);
    return () => clearInterval(t);
  }, [refreshUnread]);

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

  // React to realtime booking status updates from useBookingStatus
  const activeBooking = useBookingStore((s) => s.activeBooking);
  useEffect(() => {
    if (!activeBooking || !id) return;
    setBooking(activeBooking);
    // Refresh status logs when status changes
    bookingService.trackBooking(id).then((trackRes) => {
      setStatusLogs(trackRes.data.data?.status_logs ?? []);
    }).catch(() => {});
    if (activeBooking.status === 'completed') {
      router.replace(`/(customer)/rate/${id}`);
    }
  }, [activeBooking?.status]);

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
    if (!id || isCancelling) return;
    setShowCancelModal(true);
    setPreviewLoading(true);
    bookingService
      .cancelPreview(id)
      .then((res) => setCancelPreview(res.data.data))
      .catch(() => setCancelPreview(null))
      .finally(() => setPreviewLoading(false));
  }, [id, isCancelling]);

  const confirmCancel = useCallback(async () => {
    if (!id) return;
    setIsCancelling(true);
    try {
      await bookingService.cancelBooking(id);
      setActiveBooking(null);
      setShowCancelModal(false);
      router.replace('/(customer)/(tabs)');
    } catch {
      toast.error('Failed to cancel booking');
    } finally {
      setIsCancelling(false);
    }
  }, [id, setActiveBooking, router]);

  const handleSOS = useCallback(() => {
    if (!id) return;
    setShowSOSModal(true);
  }, [id]);

  const confirmSOS = useCallback(async () => {
    if (!id) return;
    try {
      await bookingService.triggerSOS(id);
      setSosActive(true);
      setShowSOSModal(false);
    } catch {
      toast.error('Failed to trigger SOS');
    }
  }, [id]);

  const handleCall = useCallback(() => {
    const phone = booking?.runner?.phone ?? null;
    if (phone) {
      Linking.openURL(`tel:${phone}`).catch(() => toast.error('Could not start call'));
    } else {
      toast.error('Runner phone not available yet');
    }
  }, [booking]);

  const handleShareTrip = useCallback(async () => {
    if (!id) return;
    try {
      await bookingService.shareTrip(id);
      toast.success('Trip sharing link has been generated');
    } catch {
      toast.error('Failed to share trip');
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
        <Text className="text-lg font-montserrat-semi text-textPrimary">
          Booking not found
        </Text>
        <View className="mt-4">
          <Button title="Go Home" onPress={() => router.replace('/(customer)/(tabs)')} />
        </View>
      </SafeAreaView>
    );
  }

  const isTransportation = booking.is_transportation;
  const errandRule = getErrandTypeRule(booking.errand_type?.slug);
  // Use the per-type flow so single-location errands (queue / bills /
  // document) don't show dropoff stages they will never reach.
  const steps = errandRule.statusFlow as unknown as BookingStatus[];
  const currentStatusIndex = steps.indexOf(booking.status);
  const isShopping = errandRule.requiresShoppingBudget;
  // Once a shopping runner has picked up (paid for) the items, the customer
  // can no longer self-cancel — they would still owe the spent amount.
  const canCancel =
    CAN_CANCEL_STATUSES.includes(booking.status) &&
    !(isShopping && !!booking.picked_up_at);

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
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Live Map — fills the entire screen so the user can view it as a whole */}
      <View style={StyleSheet.absoluteFill}>
        <Mapbox.MapView
          style={{ flex: 1 }}
          styleURL={MAP_STYLE_URL}
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

      {/* Floating header — sits above the map and the sheet */}
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <View className="flex-row items-center px-5 py-2" pointerEvents="box-none">
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(customer)/(tabs)')}
            className="w-10 h-10 rounded-full bg-white items-center justify-center mr-3"
            style={styles.floatingShadow}
          >
            <ArrowLeft size={20} color="#0F172A" />
          </Pressable>
          <View className="flex-1 bg-white rounded-full px-4 py-2" style={styles.floatingShadow}>
            <Text className="text-sm font-montserrat-semi text-textPrimary" numberOfLines={1}>
              {STATUS_LABELS[booking.status]}
            </Text>
            <Text className="text-[10px] font-montserrat text-textSecondary">
              {booking.booking_number}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Draggable bottom sheet — peek/half/full so the customer can collapse it
          for an unobstructed map view, or expand for full details. */}
      <ExpandableSheet
        initial="half"
        renderHandle={() => (
          <View className="px-5 pt-1 pb-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {STATUS_LABELS[booking.status]}
              </Text>
              {booking.runner_id && (
                <View className="flex-row items-center">
                  <View className={`w-2 h-2 rounded-full mr-1.5 ${isConnected ? 'bg-success' : 'bg-gray-400'}`} />
                  <Text className="text-[10px] font-montserrat text-textSecondary">
                    {isConnected ? 'Live tracking' : 'Connecting…'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      >
        <ScrollView
          className="flex-1 px-5 pt-2"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
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
                {unreadForBooking > 0 && (
                  <View className="absolute top-0 right-0 min-w-[16px] h-4 px-1 bg-danger rounded-full items-center justify-center border-[1.5px] border-white">
                    <Text className="text-[9px] text-white font-montserrat-bold leading-[11px]">
                      {unreadForBooking > 9 ? '9+' : String(unreadForBooking)}
                    </Text>
                  </View>
                )}
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

        {/* Shopping reconciliation card — visible whenever a shopping budget
            was pre-authorized so the customer can see what was approved
            and, after pickup, exactly what the runner spent. */}
        {isShopping && booking.shopping_budget != null && (
          <View className="bg-primary/5 border border-primary/30 rounded-xl p-4 mb-4">
            <Text className="text-xs font-montserrat-bold text-primary uppercase mb-2">
              Shopping summary
            </Text>
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="text-sm font-montserrat text-textSecondary">
                Pre-authorized budget
              </Text>
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {formatCurrency(booking.shopping_budget)}
              </Text>
            </View>
            {booking.actual_item_cost != null ? (
              <>
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text className="text-sm font-montserrat text-textSecondary">
                    Actual receipt amount
                  </Text>
                  <Text className="text-sm font-montserrat-bold text-textPrimary">
                    {formatCurrency(booking.actual_item_cost)}
                  </Text>
                </View>
                <View className="h-px bg-divider my-2" />
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-montserrat-semi text-textPrimary">
                    {booking.actual_item_cost <= booking.shopping_budget
                      ? 'Refund to wallet'
                      : 'Additional due'}
                  </Text>
                  <Text
                    className={`text-base font-montserrat-bold ${
                      booking.actual_item_cost <= booking.shopping_budget
                        ? 'text-success'
                        : 'text-warning'
                    }`}
                  >
                    {formatCurrency(
                      Math.abs(booking.shopping_budget - booking.actual_item_cost),
                    )}
                  </Text>
                </View>
                {booking.receipt_photo_url && (
                  <Pressable
                    onPress={() =>
                      booking.receipt_photo_url &&
                      Linking.openURL(booking.receipt_photo_url).catch(() =>
                        toast.error('Could not open receipt'),
                      )
                    }
                    className="mt-3 flex-row items-center"
                  >
                    <Image
                      source={{ uri: booking.receipt_photo_url }}
                      className="w-12 h-12 rounded-lg mr-2 bg-divider"
                    />
                    <Text className="text-xs font-montserrat-semi text-primary">
                      View receipt
                    </Text>
                  </Pressable>
                )}
              </>
            ) : (
              <Text className="text-xs font-montserrat text-textTertiary mt-1">
                The runner will upload a receipt at pickup so you can see the
                exact amount spent.
              </Text>
            )}
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
            <Button title={isCancelling ? 'Cancelling...' : 'Cancel Errand'} variant="outline" onPress={handleCancel} disabled={isCancelling} fullWidth />
          )}
          {isShopping && booking.picked_up_at && CAN_CANCEL_STATUSES.includes(booking.status) === false && booking.status !== 'completed' && booking.status !== 'cancelled' && (
            <View className="bg-warning/10 border border-warning/40 rounded-xl p-3">
              <Text className="text-xs font-montserrat-semi text-warning text-center">
                Your runner already paid for the items. Cancel is no longer available.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
      </ExpandableSheet>

      {/* Cancel confirmation */}
      <ConfirmModal
        visible={showCancelModal}
        title="Cancel booking?"
        message={
          previewLoading
            ? 'Checking cancellation policy…'
            : cancelPreview
              ? cancelPreview.fee > 0
                ? `${cancelPreview.reason}\n\nCancellation fee: ₱${cancelPreview.fee.toFixed(2)}`
                : cancelPreview.reason
              : "The runner will be notified. This action can't be undone."
        }
        confirmLabel={
          cancelPreview && cancelPreview.fee > 0
            ? `Cancel & pay ₱${cancelPreview.fee.toFixed(2)}`
            : 'Yes, cancel'
        }
        cancelLabel="Keep booking"
        destructive
        loading={isCancelling}
        onConfirm={confirmCancel}
        onCancel={() => {
          setShowCancelModal(false);
          setCancelPreview(null);
        }}
      />

      {/* SOS confirmation */}
      <ConfirmModal
        visible={showSOSModal}
        title="Emergency SOS"
        message="This will alert your trusted contacts and our support team. Continue?"
        confirmLabel="Trigger SOS"
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmSOS}
        onCancel={() => setShowSOSModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  floatingShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
});
