import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  X,
  ArrowUpRight,
  ArrowUp,
  ArrowUpLeft,
  CornerUpRight,
  CornerUpLeft,
  Flag,
  Locate,
  AlertTriangle,
} from 'lucide-react-native';
import Mapbox from '@rnmapbox/maps';
import { MAP_STYLE_URL } from '../../../constants/map';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useLocationStore } from '../../../stores/locationStore';
import { useForegroundInterval } from '../../../hooks/useForegroundInterval';
import { runnerService } from '../../../services/runner.service';
import { routeService, type NavigationRoute, type NavigationStep } from '../../../services/route.service';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import { toast } from '../../../stores/toastStore';
import type { Booking } from '../../../types';

/**
 * Statuses where the runner is travelling toward the pickup pin.
 * Mirrors the same set in the active errand screen so the navigate
 * destination matches what the rest of the UI is showing.
 */
const PICKUP_PHASE_STATUSES = new Set<string>([
  'matched',
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
]);

/** Equirectangular distance in metres \u2014 cheap, plenty accurate <5km. */
function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * 111_000;
  const dLng = (b.lng - a.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Pick the icon that matches a Mapbox maneuver. Limited set on purpose
 * \u2014 lucide doesn't ship every variant, and the modifier fallback
 * keeps the banner readable for unmapped types.
 */
function ManeuverIcon({ type, modifier, size = 28, color = '#0F172A' }: {
  type: string;
  modifier: string | null;
  size?: number;
  color?: string;
}) {
  if (type === 'arrive' || type === 'arrived') {
    return <Flag size={size} color={color} />;
  }
  switch (modifier) {
    case 'left':
    case 'sharp left':
      return <CornerUpLeft size={size} color={color} />;
    case 'right':
    case 'sharp right':
      return <CornerUpRight size={size} color={color} />;
    case 'slight left':
      return <ArrowUpLeft size={size} color={color} />;
    case 'slight right':
      return <ArrowUpRight size={size} color={color} />;
    case 'straight':
    case 'uturn':
    default:
      return <ArrowUp size={size} color={color} />;
  }
}

function fmtDistance(meters: number): string {
  if (meters < 50) return 'Now';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${rem}m`;
}

function fmtArrival(secondsFromNow: number): string {
  const arrive = new Date(Date.now() + secondsFromNow * 1000);
  return arrive.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function NavigateScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentErrand = useRunnerStore((s) => s.currentErrand);
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const isTracking = useLocationStore((s) => s.isTracking);
  const startTracking = useLocationStore((s) => s.startTracking);

  const [booking, setBooking] = useState<Booking | null>(
    currentErrand?.id === id ? currentErrand : null,
  );
  const [navRoute, setNavRoute] = useState<NavigationRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(false);
  const [followCamera, setFollowCamera] = useState(true);

  const cameraRef = useRef<Mapbox.Camera>(null);

  // Make sure GPS is streaming \u2014 the runner may have opened this
  // screen from a notification cold-start where the dashboard hasn't
  // yet started the watcher.
  useEffect(() => {
    if (!isTracking) startTracking().catch(() => {});
  }, [isTracking, startTracking]);

  // Hydrate booking when the store is empty (deep link / cold start).
  // The endpoint is server-scoped to the runner's bookings, so a 200
  // response is itself proof of ownership.
  useEffect(() => {
    if (!id || booking) return;
    runnerService
      .getErrand(id)
      .then((r) => setBooking((r?.data?.data ?? null) as Booking | null))
      .catch(() => {});
  }, [id, booking]);

  // Resolve the right destination based on phase. Single-location
  // errands (queue / bills / on-site documents) only have a pickup pin.
  const errandRule = getErrandTypeRule(booking?.errand_type?.slug);
  const isSingleLocation = errandRule.singleLocation;
  const inPickupPhase =
    isSingleLocation || (booking ? PICKUP_PHASE_STATUSES.has(booking.status) : true);

  const destination = useMemo(() => {
    if (!booking) return null;
    const lat = inPickupPhase ? booking.pickup_lat : booking.dropoff_lat;
    const lng = inPickupPhase ? booking.pickup_lng : booking.dropoff_lng;
    if (lat == null || lng == null) return null;
    const nLat = Number(lat);
    const nLng = Number(lng);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;
    return { lat: nLat, lng: nLng };
  }, [booking, inPickupPhase]);

  const destLabel = inPickupPhase
    ? booking?.pickup_address ?? 'Pickup'
    : booking?.dropoff_address ?? 'Dropoff';

  const origin = useMemo(() => {
    if (!currentLocation) return null;
    return { lat: currentLocation.lat, lng: currentLocation.lng };
  }, [currentLocation]);

  // Snap origin to ~110m so we don't refetch the whole route on every
  // GPS tick. We'll also hard-refetch when the runner deviates from the
  // polyline (handled below).
  const originKey = origin ? `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}` : '';
  const destKey = destination ? `${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}` : '';
  const lastFetchKeyRef = useRef<string>('');

  const fetchNav = useCallback(async () => {
    if (!origin || !destination) return;
    setRouteLoading(true);
    setRouteError(false);
    const r = await routeService.getNavigationRoute(origin, destination);
    if (r) {
      setNavRoute(r);
      setRouteError(false);
    } else {
      setRouteError(true);
    }
    setRouteLoading(false);
  }, [origin, destination]);

  useEffect(() => {
    if (!origin || !destination) return;
    const key = `${originKey}|${destKey}`;
    if (key === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = key;
    void fetchNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, destKey]);

  // ── Off-route + step progression ──
  // Find the nearest point on the active route geometry. If the runner
  // is more than 60m off the polyline for two consecutive checks, we
  // re-route. The step we're on is the first step whose end point we
  // haven't reached yet (within 25m of the maneuver location).
  const offRouteStrikesRef = useRef(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distanceToNextManeuver, setDistanceToNextManeuver] = useState<number | null>(null);

  useEffect(() => {
    if (!origin || !navRoute || navRoute.steps.length === 0) return;

    // 1) Advance current step. Walk forward from the current index and
    //    drop steps the runner has already passed (within ~25m of the
    //    maneuver point AND past it along the geometry).
    let idx = currentStepIdx;
    while (idx < navRoute.steps.length - 1) {
      const step = navRoute.steps[idx];
      const [mLng, mLat] = step.location;
      const d = distMeters(origin, { lat: mLat, lng: mLng });
      if (d < 25) {
        idx += 1;
      } else {
        break;
      }
    }
    if (idx !== currentStepIdx) setCurrentStepIdx(idx);

    // 2) Distance to next maneuver = distance from runner to the END
    //    of the current step (which is the location of the NEXT step's
    //    maneuver, or the destination for the last step).
    const step = navRoute.steps[idx];
    const next = navRoute.steps[idx + 1];
    const target = next ? next.location : navRoute.coordinates[navRoute.coordinates.length - 1];
    if (target) {
      setDistanceToNextManeuver(distMeters(origin, { lat: target[1], lng: target[0] }));
    }

    // 3) Off-route detection \u2014 sample distance to nearest vertex on
    //    the remaining polyline. Cheap and correct enough for a city
    //    grid (full point-to-segment is overkill for a 60m threshold).
    let nearest = Infinity;
    for (let i = 0; i < navRoute.coordinates.length; i++) {
      const [lng, lat] = navRoute.coordinates[i];
      const d = distMeters(origin, { lat, lng });
      if (d < nearest) nearest = d;
      if (nearest < 30) break; // good enough \u2014 don't keep walking
    }
    if (nearest > 60) {
      offRouteStrikesRef.current += 1;
      if (offRouteStrikesRef.current >= 2) {
        offRouteStrikesRef.current = 0;
        // Refetch from current position; lastFetchKeyRef is updated by
        // the originKey/destKey effect on the next GPS tick anyway.
        toast.info('Recalculating route\u2026');
        void fetchNav();
      }
    } else {
      offRouteStrikesRef.current = 0;
    }
  }, [origin, navRoute, currentStepIdx, fetchNav]);

  // Periodic ETA refresh \u2014 every 60s rebuild the route so traffic +
  // remaining duration stay reasonable. Cheap because Mapbox eats the
  // request and the runner hasn't moved far between refreshes.
  useForegroundInterval(() => { void fetchNav(); }, 60_000, !!origin && !!destination, false);

  // Camera follow. We can't get device heading from the location store
  // (it only persists lat/lng), but Mapbox's UserLocation puck gives
  // us a course-up camera for free with `followUserMode: 'course'` and
  // a UserTrackingMode on the camera. We toggle it off when the user
  // pans the map and re-engage with the recenter button.
  const followMode = followCamera ? Mapbox.UserTrackingMode.FollowWithCourse : undefined;

  const handleEndNavigation = useCallback(() => {
    router.back();
  }, [router]);

  const handleArrived = useCallback(async () => {
    if (!booking) return;
    // We deliberately don't push a status change from here. The
    // arrival status (arrived_at_pickup / arrived_at_dropoff) is
    // owned by the StatusActionButton on the errand screen so the
    // photo-proof modals trigger correctly. Just route the runner
    // back to act on it.
    router.back();
  }, [booking, router]);

  // ── Render ──
  const routeGeoJSON = useMemo(() => {
    if (!navRoute || navRoute.coordinates.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: navRoute.coordinates },
    };
  }, [navRoute]);

  const currentStep: NavigationStep | null = navRoute?.steps[currentStepIdx] ?? null;

  // Remaining ETA: sum of remaining step durations, minus any progress
  // we've made into the current step.
  const remainingDistance = useMemo(() => {
    if (!navRoute) return null;
    let total = 0;
    for (let i = currentStepIdx; i < navRoute.steps.length; i++) {
      total += navRoute.steps[i].distanceMeters;
    }
    return total;
  }, [navRoute, currentStepIdx]);

  const remainingDuration = useMemo(() => {
    if (!navRoute) return null;
    let total = 0;
    for (let i = currentStepIdx; i < navRoute.steps.length; i++) {
      total += navRoute.steps[i].durationSeconds;
    }
    return total;
  }, [navRoute, currentStepIdx]);

  // Approaching destination cue.
  const arrivedSoon =
    remainingDistance != null && remainingDistance < 80;

  if (!booking) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="small" color="#2563EB" />
        <Text className="mt-3 text-xs font-montserrat text-textSecondary">Preparing navigation\u2026</Text>
      </View>
    );
  }

  if (!destination) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-8" edges={['top']}>
        <AlertTriangle size={28} color="#DC2626" />
        <Text className="text-base font-montserrat-bold text-textPrimary mt-3 mb-1">No destination</Text>
        <Text className="text-xs font-montserrat text-textSecondary text-center mb-4">
          This errand doesn't have a navigable destination right now.
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="px-5 py-2.5 rounded-full bg-primary"
        >
          <Text className="text-white text-sm font-montserrat-bold">Go Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0F172A' }}>
      {/* Full-screen map */}
      <View style={StyleSheet.absoluteFill}>
        <Mapbox.MapView
          style={{ flex: 1 }}
          styleURL={MAP_STYLE_URL}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          onMapIdle={() => { /* no-op \u2014 follow toggling done via gestures below */ }}
          onTouchMove={() => {
            // Any user pan disengages course-follow until they tap recenter.
            if (followCamera) setFollowCamera(false);
          }}
        >
          <Mapbox.Camera
            ref={cameraRef}
            zoomLevel={17}
            pitch={50}
            followUserLocation={followCamera}
            followUserMode={followMode}
            followZoomLevel={17}
            followPitch={50}
            animationMode="flyTo"
            animationDuration={500}
            {...(!followCamera && origin
              ? { centerCoordinate: [origin.lng, origin.lat] }
              : {})}
          />

          {/* User puck \u2014 Mapbox's native course-aware location pin. */}
          <Mapbox.UserLocation
            visible
            showsUserHeadingIndicator
            androidRenderMode="compass"
          />

          {/* Destination marker */}
          <Mapbox.MarkerView
            id="nav-dest"
            coordinate={[destination.lng, destination.lat]}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
          >
            <View className="items-center">
              <View
                className={`w-10 h-10 rounded-full items-center justify-center border-[3px] border-white shadow-lg ${
                  inPickupPhase ? 'bg-primary' : 'bg-danger'
                }`}
              >
                <Flag size={18} color="#FFFFFF" />
              </View>
            </View>
          </Mapbox.MarkerView>

          {/* Route polyline (cased line for readability over busy maps) */}
          {routeGeoJSON && (
            <Mapbox.ShapeSource id="nav-route" shape={routeGeoJSON}>
              <Mapbox.LineLayer
                id="nav-route-casing"
                style={{
                  lineColor: '#1E40AF',
                  lineWidth: 9,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineOpacity: 0.95,
                }}
              />
              <Mapbox.LineLayer
                id="nav-route-fill"
                style={{
                  lineColor: '#3B82F6',
                  lineWidth: 6,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </Mapbox.ShapeSource>
          )}
        </Mapbox.MapView>
      </View>

      {/* Top maneuver banner \u2014 the navigation focal point. */}
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <View
          className="mx-3 mt-2 rounded-2xl bg-primary px-4 py-3.5 flex-row items-center"
          style={{
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <View className="w-12 h-12 rounded-full bg-white/20 items-center justify-center mr-3">
            {currentStep ? (
              <ManeuverIcon
                type={currentStep.maneuverType}
                modifier={currentStep.maneuverModifier}
                color="#FFFFFF"
                size={26}
              />
            ) : (
              <ArrowUp size={26} color="#FFFFFF" />
            )}
          </View>
          <View className="flex-1">
            <Text className="text-white text-[11px] font-montserrat-bold uppercase tracking-wider opacity-80">
              {distanceToNextManeuver != null
                ? `In ${fmtDistance(distanceToNextManeuver)}`
                : routeLoading
                ? 'Calculating\u2026'
                : routeError
                ? 'Route unavailable'
                : 'Preparing route'}
            </Text>
            <Text
              className="text-white text-[15px] font-montserrat-bold mt-0.5"
              numberOfLines={2}
            >
              {currentStep?.instruction ?? `Head to ${destLabel}`}
            </Text>
          </View>
          <Pressable
            onPress={handleEndNavigation}
            hitSlop={10}
            className="w-10 h-10 rounded-full bg-white/15 items-center justify-center ml-2"
            accessibilityRole="button"
            accessibilityLabel="End navigation"
          >
            <X size={18} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Destination subtitle \u2014 keeps the runner aware of where they're heading. */}
        <View className="mx-3 mt-1.5 rounded-xl bg-black/55 px-3 py-1.5 self-start">
          <Text
            className="text-white text-[11px] font-montserrat"
            numberOfLines={1}
          >
            {inPickupPhase ? 'Pickup' : 'Dropoff'}: {destLabel}
          </Text>
        </View>
      </SafeAreaView>

      {/* Recenter FAB \u2014 visible whenever course-follow is disengaged. */}
      {!followCamera && (
        <Pressable
          onPress={() => setFollowCamera(true)}
          accessibilityRole="button"
          accessibilityLabel="Recenter map on your location"
          className="absolute right-4 bottom-44 w-12 h-12 rounded-full bg-white items-center justify-center"
          style={{
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 6,
          }}
        >
          <Locate size={20} color="#0F172A" />
        </Pressable>
      )}

      {/* Bottom ETA / actions bar \u2014 always visible. */}
      <View
        className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl px-5 pt-4"
        style={{
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: -4 },
          elevation: 10,
        }}
      >
        <View className="flex-row items-end justify-between">
          <View className="flex-1">
            <Text className="text-[28px] font-montserrat-bold text-textPrimary leading-tight">
              {remainingDuration != null ? fmtDuration(remainingDuration) : '\u2014'}
            </Text>
            <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
              {remainingDistance != null ? fmtDistance(remainingDistance) : ''}
              {remainingDuration != null && remainingDistance != null ? ' \u00b7 ' : ''}
              {remainingDuration != null ? `arrives ${fmtArrival(remainingDuration)}` : ''}
            </Text>
          </View>
          {arrivedSoon ? (
            <Pressable
              onPress={handleArrived}
              className="px-5 py-3 rounded-full bg-success ml-3"
            >
              <Text className="text-white text-sm font-montserrat-bold">I&apos;ve Arrived</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleEndNavigation}
              className="px-5 py-3 rounded-full bg-gray-200 ml-3"
            >
              <Text className="text-textPrimary text-sm font-montserrat-bold">End</Text>
            </Pressable>
          )}
        </View>

        {routeError && (
          <Pressable
            onPress={fetchNav}
            className="mt-3 mb-1 self-center px-4 py-1.5 rounded-full bg-danger/10"
          >
            <Text className="text-danger text-[11px] font-montserrat-bold uppercase tracking-wider">
              Retry route
            </Text>
          </Pressable>
        )}

        <SafeAreaView edges={['bottom']} />
      </View>
    </View>
  );
}
