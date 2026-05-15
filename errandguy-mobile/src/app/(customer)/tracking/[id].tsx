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
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  MessageCircle,
  Phone,
  Share2,
  Shield,
  Bike,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HereMapView, HereMarker, HerePolyline, type HereMapViewRef } from '../../../components/map';
import { useBookingStore } from '../../../stores/bookingStore';
import { useChatStore } from '../../../stores/chatStore';
import { useLocationStore } from '../../../stores/locationStore';
import { bookingService } from '../../../services/booking.service';
import { useRunnerTracking } from '../../../hooks/useRunnerTracking';
import { useBookingStatus } from '../../../hooks/useBookingStatus';
import { useForegroundInterval } from '../../../hooks/useForegroundInterval';
import { useBackGuard } from '../../../hooks/useBackGuard';
import { useEta } from '../../../hooks/useEta';
import { TrackingSkeleton } from '../../../components/ui/Skeleton';
import { Avatar } from '../../../components/ui/Avatar';
import { RatingStars } from '../../../components/ui/RatingStars';
import { StatusTimeline } from '../../../components/ui/StatusTimeline';
import { JourneyBeads } from '../../../components/ui/JourneyBeads';
import { CurrentStepHero } from '../../../components/ui/CurrentStepHero';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { ExpandableSheet } from '../../../components/ui/ExpandableSheet';
import { formatTime } from '../../../utils/formatDate';
import { formatCurrency } from '../../../utils/formatCurrency';
import { resolveImageUrl } from '../../../utils/resolveImageUrl';
import { STATUS_LABELS } from '../../../constants/statusLabels';

import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import type { Booking, BookingStatus, BookingStatusLog } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { routeService } from '../../../services/route.service';


const CAN_CANCEL_STATUSES: BookingStatus[] = [
  'pending', 'matched', 'accepted', 'heading_to_pickup',
];

export default function TrackingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // IMPORTANT: select with a getter so the reference stays stable across
  // unrelated state changes. `useBookingStore()` (no selector) returns the
  // entire store snapshot on every render, which made `setActiveBooking`
  // a fresh reference every time and re-fired the fetch effect — causing
  // 3-4 redundant /bookings/{id} + /track requests per visit.
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
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
  const [sosActive, setSosActive] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  // null = idle, 'loading' = first fetch in flight, 'error' = last fetch
  // failed (e.g. 401/429/network). Surfaces a user-facing retry chip.
  const [routeFetchState, setRouteFetchState] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  // Trip details (timeline, shopping breakdown, proof photos) collapse
  // by default so the bottom sheet stays uncluttered. Customers who
  // want the verbose breakdown tap "Trip details" to expand. We keep
  // the toggle in component state — no global store, no animation lib —
  // so reopening the screen restores the default minimal view.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cancelPreview, setCancelPreview] = useState<{
    fee: number;
    tier: 'free' | 'flat' | 'percentage';
    reason: string;
    cancellable: boolean;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showSOSModal, setShowSOSModal] = useState(false);
  const mapRef = useRef<HereMapViewRef>(null);
  // Tracks the last booking status we have already loaded statusLogs for.
  // Used to skip redundant /track refetches when realtime UPDATEs come in
  // for unrelated fields. Declared before the fetch effect that seeds it.
  const lastSyncedStatusRef = useRef<BookingStatus | null>(null);

  // Live runner location via Supabase Realtime
  const { runnerLocation, isConnected } = useRunnerTracking(
    booking?.runner_id ? (id ?? null) : null,
  );

  // Looping pulse driver shared between the on-map runner marker and
  // the bottom-right "live" pill. Only animates while the runner has
  // a positive speed reading so the pulse reads as actual movement.
  const runnerPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const moving = runnerLocation?.speed != null && runnerLocation.speed > 0;
    if (!moving) {
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
  }, [runnerLocation?.speed, runnerPulse]);

  // Live booking status updates via Supabase Realtime
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
      .trackBooking(id)
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
  useEffect(() => {
    if (!id) return;
    // Only show the skeleton if we don't already have a cached snapshot.
    if (!cachedBooking) setLoading(true);
    bookingService
      .getBooking(id)
      .then((bookingRes) => {
        const b = bookingRes.data.data;
        setBooking(b);
        setActiveBooking(b);
        setStatusLogs(b?.status_logs ?? []);
        // Seed the realtime guard so the very first realtime UPDATE
        // (which carries the same status we just loaded) does not
        // trigger a redundant /track refetch.
        lastSyncedStatusRef.current = b?.status ?? null;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // cachedBooking intentionally omitted — we only want to fire the fetch
    // when the route id changes, not when the store updates afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, setActiveBooking]);

  // Poll chat unread counts every 30s while on the tracking screen so the
  // chat badge stays fresh without a websocket. Refresh once on mount too.
  // Pauses automatically when the app is backgrounded.
  useForegroundInterval(refreshUnread, 30000);

  // Polling fallback for the runner's live position. Supabase Realtime
  // is the primary path (useRunnerTracking) but in production we have
  // observed cases where the channel reports SUBSCRIBED yet never
  // delivers payloads (RLS blocks anon SELECT, table not in the
  // realtime publication, free-tier websocket eviction, etc.). We
  // adapt the poll cadence to the realtime health: when BOTH the
  // location channel and the booking-status channel are connected we
  // tail the server every 20s purely as a sanity reconcile; if either
  // channel is silent we drop back to 5s so the pin keeps moving.
  // This mirrors Grab's "always live" feel in the failure mode while
  // collapsing happy-path traffic 4\u00d7 (12 GETs/min \u2192 3).
  const realtimeHealthy = isConnected && statusConnected;
  const trackPollMs = realtimeHealthy ? 20_000 : 5_000;
  useForegroundInterval(
    () => {
      if (!id || !booking?.runner_id) return;
      bookingService
        .trackBooking(id)
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
          // Reconcile booking status from the poll. Pushing into the
          // global store routes through the same realtime-driven
          // useEffect above (`activeBooking` watcher), which fires the
          // status-change toasts + triggers the status-log refresh.
          const fresh = data?.booking;
          if (fresh && fresh.status !== booking.status) {
            setActiveBooking(fresh);
          }
        })
        .catch(() => {});
    },
    trackPollMs,
    !!id && !!booking?.runner_id,
    true,
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
      .getRoute({ lng: from.lng, lat: from.lat }, { lng: to.lng, lat: to.lat })
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
  const arrivalCueRef = useRef<string | null>(null);
  useEffect(() => {
    if (eta.distanceMeters == null) return;
    const phaseKey = `${booking?.id ?? ''}:${isPickupPhase ? 'p' : 'd'}`;
    if (eta.distanceMeters < 250 && arrivalCueRef.current !== phaseKey) {
      arrivalCueRef.current = phaseKey;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      toast.success(
        isPickupPhase ? 'Runner is arriving at pickup' : 'Runner is almost at the dropoff',
      );
    }
    // Clear the latch when the runner is back outside the radius (e.g.
    // re-routed) so a second approach can re-trigger.
    if (eta.distanceMeters > 600 && arrivalCueRef.current === phaseKey) {
      arrivalCueRef.current = null;
    }
  }, [eta.distanceMeters, isPickupPhase, booking?.id]);

  // Force-refresh the route polyline (bypasses the AsyncStorage cache).
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
        setStatusLogs(trackRes.data.data?.status_logs ?? []);
      }).catch(() => {});

      // User-visible confirmation that something happened. Without this
      // the customer has no idea the runner accepted unless they happen
      // to be staring at the timeline pill. Push notifications cover
      // backgrounded users; this covers the foreground case.
      if (prev != null) {
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
          default:
            break;
        }
      }
    }
    if (activeBooking.status === 'completed') {
      router.replace(`/(customer)/rate/${id}`);
    }
  }, [activeBooking, id, router]);

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
      animated: true,
    });
  }, [cameraBounds]);


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
      // Backend requires `reason` to be present (422 otherwise). The
      // sheet doesn't currently expose a free-text input, so fall back
      // to a clear default that audit logs / refund flows can key off.
      await bookingService.cancelBooking(id, 'Cancelled by customer');
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

  const handleShareTrip = useCallback(async () => {
    if (!id) return;
    try {
      await bookingService.shareTrip(id);
      toast.success('Trip sharing link has been generated');
    } catch {
      toast.error('Failed to share trip');
    }
  }, [id]);

  // Active = anything other than terminal states. Used to gate the Android
  // back-button guard so completed/cancelled bookings let the user leave freely.
  // Must run BEFORE any conditional early-return below — hooks rules.
  const isLiveBooking =
    !!booking && !['completed', 'cancelled', 'no_runner'].includes(booking.status);
  useBackGuard(isLiveBooking, 'Tracking your errand — tap back again to leave');

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

  // Hero copy — verb-led, role-aware. Mapped per-status so the headline
  // reads as a sentence about what's happening RIGHT NOW from the
  // customer's perspective (e.g. "On the way to you" rather than the
  // backend-flavored "In Transit"). Falls back to STATUS_LABELS for any
  // unmapped status so we never render an empty headline.
  const heroCopy: { title: string; subtitle?: string; accent: 'brand' | 'success' | 'danger' | 'warning' } = (() => {
    const runnerName = booking.runner?.full_name?.split(' ')[0];
    switch (booking.status) {
      case 'pending':
        return { title: 'Finding you a runner', subtitle: 'Usually takes under a minute.', accent: 'warning' };
      case 'no_runner':
        return { title: 'No runner available', subtitle: 'Try again in a few minutes.', accent: 'danger' };
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
      case 'arrived_at_pickup':
        return { title: 'Arrived at pickup', subtitle: isShopping ? 'Shopping for your items now.' : 'Picking up your order.', accent: 'brand' };
      case 'picked_up':
        return { title: 'Picked up', subtitle: 'Heading to drop-off next.', accent: 'brand' };
      case 'in_transit':
        return { title: isTransportation ? 'On the way' : 'On the way to you', accent: 'brand' };
      case 'arrived_at_dropoff':
        return { title: 'Arrived at drop-off', accent: 'brand' };
      case 'delivered':
      case 'completed':
        return { title: isTransportation ? 'Trip complete' : 'Delivered', subtitle: 'Thanks for using ErrandGuy.', accent: 'success' };
      case 'cancelled':
        return { title: 'Cancelled', accent: 'danger' };
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

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Live Map — fills the entire screen so the user can view it as a whole */}
      <View style={StyleSheet.absoluteFill}>
        <HereMapView
          ref={mapRef}
          style={{ flex: 1 }}
          showsMyLocationButton={false}
          showsCompass={false}
          initialRegion={{
            latitude: mapCenter[1],
            longitude: mapCenter[0],
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
                    {/* Pickup marker */}
          {booking.pickup_lng && booking.pickup_lat && (
            <HereMarker
              coordinate={{ latitude: Number(booking.pickup_lat), longitude: Number(booking.pickup_lng) }}
              anchor={{ x: 0.5, y: 0.5 }}
              id="pickup-marker"
            >
              <View className="items-center">
                <View className="w-8 h-8 rounded-full bg-primary items-center justify-center border-2 border-white shadow-md">
                  <Text className="text-white text-[10px] font-montserrat-bold">P</Text>
                </View>
              </View>
            </HereMarker>
          )}

          {/* Dropoff marker */}
          {booking.dropoff_lng && booking.dropoff_lat && (
            <HereMarker
              coordinate={{ latitude: Number(booking.dropoff_lat), longitude: Number(booking.dropoff_lng) }}
              anchor={{ x: 0.5, y: 0.5 }}
              id="dropoff-marker"
            >
              <View className="items-center">
                <View className="w-8 h-8 rounded-full bg-danger items-center justify-center border-2 border-white shadow-md">
                  <Text className="text-white text-[10px] font-montserrat-bold">D</Text>
                </View>
              </View>
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
                  )}
                  <View style={styles.runnerMarkerInner}>
                    <Bike size={16} color="#FFFFFF" strokeWidth={2.4} />
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
              <HerePolyline id="route-outline" coordinates={routeMapCoords} strokeColor="#1E3A8A" strokeWidth={8} lineJoin="round" />
              <HerePolyline id="route-fill" coordinates={routeMapCoords} strokeColor="#3B82F6" strokeWidth={5} lineJoin="round" />
            </>
          )}
        </HereMapView>

        {/* Realtime indicator — shows three states:
              1. Connecting (no realtime channel yet)
              2. Live + idle (runner connected, not moving)
              3. Live + moving (runner connected, GPS speed > 0)
            The third state surfaces the live km/h reading so the
            customer sees their runner is actively in motion, not
            just sitting at a red light. */}
        {booking.runner_id && (
          <View
            className="absolute bottom-3 right-3 flex-row items-center bg-white rounded-full pl-2 pr-3 py-1.5"
            style={{
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 3,
            }}
          >
            <View className="items-center justify-center mr-1.5" style={{ width: 10, height: 10 }}>
              <View className={`w-2 h-2 rounded-full ${
                isConnected
                  ? runnerLocation?.speed != null && runnerLocation.speed > 0
                    ? 'bg-success'
                    : 'bg-primary'
                  : 'bg-gray-400'
              }`} />
              {isConnected && runnerLocation?.speed != null && runnerLocation.speed > 0 && (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: '#22C55E',
                    opacity: runnerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                    transform: [{ scale: runnerPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
                  }}
                />
              )}
            </View>
            <Text className="text-[10px] font-montserrat-bold text-textPrimary">
              {!isConnected
                ? 'Connecting…'
                : runnerLocation?.speed != null && runnerLocation.speed > 0
                ? `${Math.round(runnerLocation.speed * 3.6)} km/h · moving`
                : 'Live'}
            </Text>
          </View>
        )}

        {/* Route load failure — surfaces the error that used to be silently
            swallowed and gives the user a one-tap retry that bypasses
            the cache. */}
        {routeFetchState === 'error' && (
          <View className="absolute bottom-3 left-3 right-16 flex-row items-center bg-white/95 rounded-full px-3 py-1.5 shadow-sm">
            <View className="w-2 h-2 rounded-full mr-1.5 bg-warning" />
            <Text
              className="flex-1 text-[10px] font-montserrat text-textSecondary"
              numberOfLines={1}
            >
              Couldn&apos;t load route
            </Text>
            <Pressable
              onPress={retryRoute}
              accessibilityRole="button"
              accessibilityLabel="Retry loading route"
              hitSlop={6}
              className="ml-2"
            >
              <Text className="text-[10px] font-montserrat-semibold text-primary">
                Retry
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Floating header — bold colored banner so the tracking screen
          reads as a dedicated "trip in progress" surface, not just a
          map with chrome on top. Uses the brand blue gradient feel
          (solid #2563EB) with a clear hierarchy: back chevron, status
          + booking#, then a right-aligned ETA pill on a translucent
          surface so the minutes pop. */}
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <View className="px-3 pt-2" pointerEvents="box-none">
          <View
            className="flex-row items-stretch rounded-2xl overflow-hidden"
            style={[styles.floatingShadow, { backgroundColor: '#2563EB' }]}
          >
            <Pressable
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(customer)/(tabs)')}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              className="w-12 items-center justify-center"
            >
              <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2.2} />
            </Pressable>
            <View className="flex-1 py-3 pr-3 justify-center">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-white/75"
                style={{ letterSpacing: 1.2 }}
              >
                {booking.booking_number}
              </Text>
              <Text
                className="text-[15px] font-montserrat-bold text-white mt-0.5"
                numberOfLines={1}
              >
                {STATUS_LABELS[booking.status]}
              </Text>
            </View>
            {runnerLocation && eta.minutes != null && (
              <View
                className="flex-row items-center px-4 my-2 mr-2 rounded-xl"
                style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
              >
                <View className="items-end">
                  <Text className="text-[20px] font-montserrat-bold text-white tabular-nums leading-[22px]">
                    {eta.minutes}
                    <Text className="text-[11px] font-montserrat-semi text-white/80"> min</Text>
                  </Text>
                  <Text
                    className="text-[9px] font-montserrat-bold text-white/80 uppercase mt-0.5"
                    style={{ letterSpacing: 0.8 }}
                  >
                    {isPickupPhase ? 'to pickup' : 'to drop-off'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Draggable bottom sheet — peek/half/full so the customer can collapse it
          for an unobstructed map view, or expand for full details.

          Handle: instead of repeating the status text (already in the
          floating header), we paint a horizontal "journey beads" strip
          so even at peek size the customer sees the trip's overall
          progress at a glance, with a discreet live-tracking dot. */}
      <ExpandableSheet
        initial="half"
        renderHandle={() => (
          <View className="px-5 pt-1 pb-1">
            <JourneyBeads
              status={booking.status}
              accent={booking.status === 'cancelled' ? 'danger' : 'brand'}
            />
            {booking.runner_id && (
              <View className="flex-row items-center justify-end -mt-1 mb-1">
                <View className={`w-1.5 h-1.5 rounded-full mr-1 ${isConnected ? 'bg-success' : 'bg-gray-400'}`} />
                <Text className="text-[9px] font-montserrat text-textTertiary uppercase" style={{ letterSpacing: 1 }}>
                  {isConnected ? 'Live' : 'Reconnecting'}
                </Text>
              </View>
            )}
          </View>
        )}
        footer={
          (isTransportation && !sosActive) || sosActive || canCancel ? (
            <View style={{ gap: 8 }}>
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
                <Button
                  title={isCancelling ? 'Cancelling...' : 'Cancel Errand'}
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
          contentContainerStyle={{ paddingBottom: 40 }}
        >
        {/* Hero — verb-led "what's happening right now" with optional
            ETA pill or terminal-state label. Sits at the very top of
            the sheet content so it's the first thing visible when the
            sheet expands from peek. */}
        <View className="mb-3">
          <CurrentStepHero
            eyebrow={`STEP ${Math.min(currentStatusIndex + 1, steps.length)} OF ${steps.length}`}
            title={heroCopy.title}
            subtitle={heroCopy.subtitle}
            etaMinutes={heroEtaLabel ? null : (runnerLocation ? eta.minutes : null)}
            etaLabel={heroEtaLabel}
            accent={heroCopy.accent}
            Icon={Clock}
          />
        </View>

        {/* Transportation PIN */}
        {isTransportation && booking.ride_pin && (
          <View className="bg-warning/10 border border-warning rounded-xl p-4 mb-3 items-center">
            <Text className="text-xs font-montserrat text-warning mb-1">
              Show this PIN to your runner
            </Text>
            <Text className="text-3xl font-montserrat-bold text-warning tracking-widest">
              {booking.ride_pin}
            </Text>
          </View>
        )}

        {/* ── Runner pill ─────────────────────────────────
            Mirrors the runner errand "customer pill" so both sides
            of the trip see the same identity card pattern: avatar +
            name/rating on the left, circular icon-only actions on
            the right. Wrapped in a soft surface card so it reads as
            a contained section instead of free-floating row. */}
        {booking.runner_id && (
          <View className="flex-row items-center bg-surface rounded-2xl p-3 mb-3">
            <Avatar
              size="md"
              uri={booking.runner?.avatar_url ?? undefined}
              name={booking.runner?.full_name}
              isVerified
            />
            <View className="flex-1 ml-3 mr-2">
              <Text
                className="text-[14px] font-montserrat-bold text-textPrimary"
                numberOfLines={1}
              >
                {booking.runner?.full_name ?? 'Your runner'}
              </Text>
              <View className="flex-row items-center mt-0.5">
                <RatingStars
                  value={Number(booking.runner?.avg_rating ?? 0)}
                  size={11}
                  readonly
                />
                {booking.runner?.total_ratings ? (
                  <Text className="text-[10px] font-montserrat text-textTertiary ml-1.5">
                    ({booking.runner.total_ratings})
                  </Text>
                ) : null}
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Call runner"
              hitSlop={6}
              className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center mr-2"
              onPress={handleCall}
            >
              <Phone size={17} color="#2563EB" strokeWidth={2} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                unreadForBooking > 0
                  ? `Open chat, ${unreadForBooking} unread message${unreadForBooking === 1 ? '' : 's'}`
                  : 'Open chat with runner'
              }
              hitSlop={6}
              className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center mr-2"
              onPress={() => router.push(`/(customer)/chat/${booking.id}`)}
            >
              <MessageCircle size={17} color="#2563EB" strokeWidth={2} />
              {unreadForBooking > 0 && (
                <View className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-danger rounded-full items-center justify-center border-[1.5px] border-white">
                  <Text className="text-[9px] text-white font-montserrat-bold leading-[11px]">
                    {unreadForBooking > 9 ? '9+' : String(unreadForBooking)}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share trip with a contact"
              hitSlop={6}
              className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center"
              onPress={handleShareTrip}
            >
              <Share2 size={17} color="#2563EB" strokeWidth={2} />
            </Pressable>
          </View>
        )}

        {/* Trip details — collapsed by default. We deliberately use a
            text-only toggle (not a card / not a button) so it reads as
            an inline disclosure, not another CTA competing with the
            real actions below. The chevron rotates as a subtle hint. */}
        <Pressable
          onPress={() => setDetailsOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={detailsOpen ? 'Hide trip details' : 'Show trip details'}
          hitSlop={6}
          className="flex-row items-center justify-between mt-3 mb-2"
        >
          <Text className="text-[11px] font-montserrat-bold uppercase text-textSecondary" style={{ letterSpacing: 1.4 }}>
            {detailsOpen ? 'Hide trip details' : 'Trip details'}
          </Text>
          {detailsOpen ? (
            <ChevronUp size={14} color="#64748B" />
          ) : (
            <ChevronDown size={14} color="#64748B" />
          )}
        </Pressable>
        <View className="h-px bg-divider mb-2" />

        {detailsOpen && (
          <>
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

        {/* Proof photos uploaded by the runner. We only render the card
            when at least one photo exists so it doesn't add visual noise
            for in-progress bookings. Tapping a thumbnail opens the
            full-resolution image in the OS browser. */}
        {(booking.pickup_photo_url || booking.delivery_photo_url || booking.signature_url) && (
          <View className="mt-4 bg-white rounded-xl p-4">
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
                    onPress={() =>
                      Linking.openURL(uri).catch(() =>
                        toast.error('Could not open photo'),
                      )
                    }
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open pickup proof photo"
                  >
                    <ExpoImage
                      source={{ uri }}
                      style={{ width: '100%', height: 120, borderRadius: 12, backgroundColor: '#E2E8F0' }}
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
                    onPress={() =>
                      Linking.openURL(uri).catch(() =>
                        toast.error('Could not open photo'),
                      )
                    }
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open delivery proof photo"
                  >
                    <ExpoImage
                      source={{ uri }}
                      style={{ width: '100%', height: 120, borderRadius: 12, backgroundColor: '#E2E8F0' }}
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
                    onPress={() =>
                      Linking.openURL(uri).catch(() =>
                        toast.error('Could not open signature'),
                      )
                    }
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open customer signature"
                  >
                    <ExpoImage
                      source={{ uri }}
                      style={{ width: '100%', height: 120, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' }}
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
          </View>
        )}

        {/* Status Timeline */}
        <StatusTimeline steps={timelineSteps} />
          </>
        )}

        {/* Note: SOS / Cancel actions live in the sheet `footer` so they
            remain visible regardless of snap. We keep only the contextual
            shopping-paid notice here, since it's informational. */}
        <View className="pb-6 pt-4 gap-2">
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
  runnerMarkerWrap: {
    alignItems: 'center',
  },
  runnerPulse: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#22C55E',
  },
  runnerMarkerOuter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(37, 99, 235, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  runnerMarkerInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  runnerSpeedBadge: {
    marginTop: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  runnerSpeedText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'Quicksand_600SemiBold',
    letterSpacing: 0.2,
  },
});
