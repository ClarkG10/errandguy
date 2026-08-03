import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, ScrollView, useWindowDimensions } from 'react-native';
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
  MapPin,
  Gauge,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { HereMapView, HereMarker, HerePolyline, type HereMapViewRef } from '../../../components/map';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Spinner } from '../../../components/ui/Spinner';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useLocationStore } from '../../../stores/locationStore';
import { useSmartPolling } from '../../../hooks/useSmartPolling';
import { useVoiceGuidance } from '../../../hooks/useVoiceGuidance';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { runnerService } from '../../../services/runner.service';
import { routeService, type NavigationRoute, type NavigationStep } from '../../../services/route.service';
import { ExpandableSheet } from '../../../components/ui/ExpandableSheet';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { getNextStatus } from '../../../components/runner/StatusActionButton';
import { getErrandTypeRule } from '../../../constants/errandTypeRules';
import { toast } from '../../../stores/toastStore';
import type { Booking, BookingStatus } from '../../../types';
import { LightColors, Elevation } from '../../../constants/colors';

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

/**
 * Sheet peek height as a fraction of screen height. Shared between the
 * ExpandableSheet snap points and the floating Speed HUD / Recenter FAB
 * so the chips anchor to the sheet's real peek edge (never a magic number).
 */
const SHEET_PEEK = 0.18;

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
function ManeuverIcon({ type, modifier, size = 28, color = LightColors.textPrimary }: {
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

  const { muted: voiceMuted, speak, stop: stopVoice, toggleMuted: toggleVoiceMuted } = useVoiceGuidance();
  const reducedMotion = useReducedMotion();
  const { height: screenHeight } = useWindowDimensions();

  // Anchor the floating Speed HUD + Recenter FAB just above the sheet's
  // peek edge. The sheet occupies the bottom `SHEET_PEEK` of the screen
  // (drawn from the true window bottom, home-indicator inset included),
  // so peek-height + a fixed gap keeps an identical clearance on SE,
  // Pro Max and small Android — no per-device magic number.
  const floatBottom = screenHeight * SHEET_PEEK + 12;

  const [booking, setBooking] = useState<Booking | null>(
    currentErrand?.id === id ? currentErrand : null,
  );
  const [navRoute, setNavRoute] = useState<NavigationRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(false);
  const [followCamera, setFollowCamera] = useState(true);
  // Arrival confirm — collapses the old two-step (tap "I've arrived" →
  // land back on the errand screen → tap the CTA) into a single prompt
  // that advances the status in place. See handleArrived below.
  const [showArrivedPrompt, setShowArrivedPrompt] = useState(false);
  const [arriving, setArriving] = useState(false);

  const mapRef = useRef<HereMapViewRef>(null);

  // Make sure GPS is streaming \u2014 the runner may have opened this
  // screen from a notification cold-start where the dashboard hasn't
  // yet started the watcher.
  useEffect(() => {
    if (!isTracking) startTracking().catch(() => {});
  }, [isTracking, startTracking]);

  // Hydrate booking when the store is empty (deep link / cold start).
  // The endpoint is server-scoped to the runner's bookings, so a 200
  // response is itself proof of ownership.
  //
  // Failure handling: a fetch error, a null payload, or a 12s stall all
  // flip `hydrateFailed` so the runner gets a retryable error screen
  // instead of an infinite "Preparing navigation…" spinner (the old
  // behaviour when this effect swallowed its rejection).
  const [hydrateFailed, setHydrateFailed] = useState(false);
  const [hydrateAttempt, setHydrateAttempt] = useState(0);
  useEffect(() => {
    if (!id || booking) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setHydrateFailed(true);
    }, 12_000);
    runnerService
      .getErrand(id)
      .then((r) => {
        if (cancelled) return;
        const fresh = (r?.data?.data ?? null) as Booking | null;
        if (fresh) {
          setBooking(fresh);
          setHydrateFailed(false);
        } else {
          setHydrateFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setHydrateFailed(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, booking, hydrateAttempt]);

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
  // Tracks the navRoute object we last progressed against. A refetch/reroute
  // (60s ETA refresh, ~110m origin snap, or off-route reroute) returns a
  // route RE-INDEXED from the runner's current position, so the old step
  // cursor is meaningless against it. We detect the new identity here and
  // re-derive the cursor from 0 in the same effect cycle — otherwise the
  // stale (higher) index points past the real maneuver, which showed the
  // wrong turn, collapsed the ETA to 0, and flipped on "I've Arrived" early.
  const progressionRouteRef = useRef(navRoute);

  useEffect(() => {
    if (!origin || !navRoute || navRoute.steps.length === 0) return;

    // 1) Advance current step. On a fresh route (new identity) re-derive
    //    from 0; otherwise walk forward from the current index and drop
    //    steps the runner has already passed (within ~25m of the maneuver
    //    point AND past it along the geometry). The forward-only walk is
    //    stateful on purpose — once past a maneuver the cursor must not
    //    rewind — so a route swap is the only time we reset to 0.
    const routeChanged = navRoute !== progressionRouteRef.current;
    progressionRouteRef.current = navRoute;
    let idx = routeChanged ? 0 : currentStepIdx;
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
  // remaining duration stay reasonable. Migrated off useForegroundInterval to
  // pause the refresh while offline (its main win here \u2014 getNavigationRoute
  // resolves to null rather than rejecting, so the backoff path rarely fires;
  // maxInterval still caps it at 5min should it ever reject). (P29)
  useSmartPolling(() => fetchNav(), {
    interval: 60_000,
    enabled: !!origin && !!destination,
    runOnMount: false,
    maxInterval: 300_000,
  });

  // Camera follow: when followCamera is true, move to runner position on
  // each location update. Reduce Motion is a vestibular preference, so it
  // gates HERE (the actual motion): snap instantly and drop the pitch
  // tilt rather than the 500ms animated pan that can nauseate. Voice
  // guidance is deliberately NOT gated by it (audio isn't motion).
  useEffect(() => {
    if (!followCamera || !origin) return;
    mapRef.current?.animateCamera(
      {
        center: { latitude: origin.lat, longitude: origin.lng },
        zoom: 17,
        pitch: reducedMotion ? 0 : 50,
      },
      { duration: reducedMotion ? 0 : 500 },
    );
  }, [origin, followCamera, reducedMotion]);

  const handleEndNavigation = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    stopVoice();
    router.back();
  }, [router, stopVoice]);

  const handleArrived = useCallback(() => {
    if (!booking) return;
    // Arriving is a milestone — success notification, not a mere tap.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    stopVoice();
    // Offer a single confirm instead of silently bouncing back to the
    // errand screen for a second tap.
    setShowArrivedPrompt(true);
  }, [booking, stopVoice]);

  // Advance directly to the arrival status from the navigation view.
  // ONLY the arrival transitions (arrived_at_pickup / arrived_at_dropoff)
  // are gate-free — every later step (picked_up photo, delivered proof,
  // ride PIN, completion signature) is owned by the errand screen's
  // modals, so for those we fall back to routing the runner back rather
  // than firing a bare status POST that would skip the required capture.
  const handleConfirmArrived = useCallback(async () => {
    if (!booking) return;
    const next = getNextStatus(booking.status, booking.errand_type?.slug);
    const isArrivalStep =
      next === 'arrived_at_pickup' || next === 'arrived_at_dropoff';
    if (!next || !isArrivalStep) {
      setShowArrivedPrompt(false);
      router.back();
      return;
    }
    setArriving(true);
    try {
      await runnerService.advanceErrandStatus(booking.id, next, {
        lat: currentLocation?.lat ?? null,
        lng: currentLocation?.lng ?? null,
        capturedAt: new Date().toISOString(),
      });
      // Mirror into the runner store so the errand screen + dashboard
      // reflect the new status immediately on back-navigation (the
      // service also invalidates the runner-errand query cache).
      const store = useRunnerStore.getState();
      if (store.currentErrand?.id === booking.id) {
        useRunnerStore.setState({
          currentErrand: { ...store.currentErrand, status: next as BookingStatus },
        });
      }
      setBooking((b) => (b ? { ...b, status: next as BookingStatus } : b));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setShowArrivedPrompt(false);
      router.back();
    } catch {
      setArriving(false);
      toast.error('Could not mark arrived. Try again.');
    }
  }, [booking, currentLocation, router]);

  // ── Render ──
  const routeMapCoords = useMemo(() => {
    if (!navRoute || navRoute.coordinates.length === 0) return [];
    return navRoute.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  }, [navRoute]);

  const currentStep: NavigationStep | null = navRoute?.steps[currentStepIdx] ?? null;

  // ── Spoken turn-by-turn ──
  // Announce each new maneuver exactly once as the runner progresses.
  // We key off the maneuver TEXT (not the step index): a route refetch
  // re-indexes the steps from the runner's current position, so the same
  // index can point at a different maneuver (which would miss an
  // announcement) and the same maneuver can land on a different index
  // (which would repeat one). The instruction text is stable across
  // refetches, so text-keying announces each real maneuver exactly once.
  // The short debounce swallows the ~1-frame stale cursor a route swap
  // produces before the progression effect re-settles it, so only the
  // settled maneuver is ever spoken. Suppressed ONLY when muted (handled
  // inside the hook). Voice is NOT gated by Reduce Motion — that setting
  // is vestibular (it gates the camera pan above), and spoken turn-by-turn
  // is safety-critical guidance that motion-sensitive drivers rely on most.
  const lastSpokenInstructionRef = useRef<string | null>(null);
  useEffect(() => {
    const instruction = currentStep?.instruction;
    if (!instruction) return;
    if (instruction === lastSpokenInstructionRef.current) return;
    const t = setTimeout(() => {
      lastSpokenInstructionRef.current = instruction;
      speak(instruction);
    }, 700);
    return () => clearTimeout(t);
  }, [currentStep, speak]);

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

  // Greeting/intro overlay \u2014 a brief contextual welcome that fades
  // in when the route resolves and auto-dismisses after ~3.5s. Gives
  // the runner a moment to register destination + total trip cost
  // before the turn-by-turn focus takes over. Manually dismissable.
  const [showGreeting, setShowGreeting] = useState(true);
  const greetingOpacity = useRef(new Animated.Value(0)).current;
  const routeReadyRef = useRef(false);
  useEffect(() => {
    if (!navRoute || routeReadyRef.current) return;
    routeReadyRef.current = true;
    Animated.timing(greetingOpacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
    const t = setTimeout(() => {
      Animated.timing(greetingOpacity, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start(() => setShowGreeting(false));
    }, 3500);
    return () => clearTimeout(t);
  }, [navRoute, greetingOpacity]);

  const dismissGreeting = useCallback(() => {
    Animated.timing(greetingOpacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setShowGreeting(false));
  }, [greetingOpacity]);

  // Current speed in km/h \u2014 surfaced as a live HUD chip so the runner
  // gets the same "I'm moving" feedback drivers expect from a sat-nav.
  // `speed` is provided by expo-location at runtime but isn't part of
  // the lightweight `Coordinate` type we share with the map layer, so
  // we read it through a tolerant cast.
  const locWithSpeed = currentLocation as (typeof currentLocation & { speed?: number | null }) | null;
  const speedKmh = useMemo(() => {
    const s = locWithSpeed?.speed;
    if (s == null || !Number.isFinite(s) || s <= 0) return null;
    return Math.round(s * 3.6);
  }, [locWithSpeed?.speed]);

  // Lookahead: the maneuver AFTER the current one. Shown as a small
  // "Then \u2026" line under the main banner so the runner can prep for
  // back-to-back turns (left then immediate right, etc.).
  const upcomingStep: NavigationStep | null = navRoute?.steps[currentStepIdx + 1] ?? null;

  if (!booking) {
    if (hydrateFailed) {
      return (
        <SafeAreaView className="flex-1 bg-background" edges={['top']}>
          <ErrorState
            title="Couldn't start navigation"
            description="We couldn't load this errand's route details. Check your connection and try again."
            onRetry={() => {
              setHydrateFailed(false);
              setHydrateAttempt((n) => n + 1);
            }}
          />
        </SafeAreaView>
      );
    }
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Spinner size="small" color={LightColors.primary} />
        <Text className="mt-3 text-xs font-montserrat text-textSecondary">Preparing navigation\u2026</Text>
      </View>
    );
  }

  if (!destination) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-8" edges={['top']}>
        <AlertTriangle size={28} color={LightColors.dangerDark} />
        <Text className="text-base font-montserrat-bold text-textPrimary mt-3 mb-1">No destination</Text>
        <Text className="text-xs font-montserrat text-textSecondary text-center mb-4">
          This errand doesn't have a navigable destination right now.
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="px-6 rounded-xl bg-primary items-center justify-center"
          style={({ pressed }) => ({ minHeight: 48, opacity: pressed ? 0.9 : 1 })}
          android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
        >
          <Text className="text-white text-sm font-montserrat-bold">Go Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: LightColors.textPrimary }}>
      {/* Full-screen map */}
      <View style={StyleSheet.absoluteFill}>
        <HereMapView
          ref={mapRef}
          style={{ flex: 1 }}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          initialRegion={origin ? {
            latitude: origin.lat,
            longitude: origin.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          } : {
            latitude: 14.6,
            longitude: 121.0,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          onPanDrag={() => {
            if (followCamera) setFollowCamera(false);
          }}
        >
          {/* Destination marker */}
          <HereMarker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            anchor={{ x: 0.5, y: 1 }}
            id="destination-marker"
          >
            <View className="items-center">
              <View
                className={`w-10 h-10 rounded-full items-center justify-center border-[3px] border-white shadow-lg ${
                  inPickupPhase ? 'bg-primary' : 'bg-danger'
                }`}
              >
                <Flag size={18} color={LightColors.textInverse} />
              </View>
            </View>
          </HereMarker>

                    {/* Route polyline (cased line for readability over busy maps) */}
          {routeMapCoords.length > 0 && (
            <>
              <HerePolyline
                id="route-outline"
                coordinates={routeMapCoords}
                strokeColor={LightColors.primary900}
                strokeWidth={9}
                lineJoin="round"
              />
              <HerePolyline
                id="route-fill"
                coordinates={routeMapCoords}
                strokeColor={LightColors.primary500}
                strokeWidth={6}
                lineJoin="round"
              />
            </>
          )}
        </HereMapView>
      </View>

      {/* Top maneuver banner \u2014 the navigation focal point. */}
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <View
          className="mx-3 mt-2 rounded-2xl bg-primary px-4 py-4 flex-row items-center"
          style={Elevation.lg}
        >
          <View className="w-12 h-12 rounded-full bg-white/20 items-center justify-center mr-3">
            {currentStep ? (
              <ManeuverIcon
                type={currentStep.maneuverType}
                modifier={currentStep.maneuverModifier}
                color={LightColors.textInverse}
                size={26}
              />
            ) : (
              <ArrowUp size={26} color={LightColors.textInverse} />
            )}
          </View>
          <View className="flex-1">
            {/* Distance-to-turn is the primary glance target \u2014 large,
                full-opacity, tabular Inter so the digits don't jitter. */}
            <Text
              className="text-white text-[16px] font-inter-semi uppercase tracking-wide"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {distanceToNextManeuver != null
                ? `In ${fmtDistance(distanceToNextManeuver)}`
                : routeLoading
                ? 'Calculating\u2026'
                : routeError
                ? 'Route unavailable'
                : 'Preparing route'}
            </Text>
            <Text
              className="text-white text-[22px] font-montserrat-bold leading-[28px] mt-0.5"
              numberOfLines={2}
            >
              {currentStep?.instruction ?? `Head to ${destLabel}`}
            </Text>
            {upcomingStep && (
              // Full-opacity white — white/90 on the blue banner measures
              // ~4.4:1, just under the 4.5:1 AA floor for this 12px sub-line.
              <Text
                className="text-white text-[12px] font-montserrat mt-1"
                numberOfLines={1}
              >
                Then {upcomingStep.instruction}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              toggleVoiceMuted();
            }}
            hitSlop={10}
            // Muted state carries a distinct SOLID amber fill (not just a
            // glyph swap) so "voice off" is unmistakable in a sunlit glance;
            // unmuted stays translucent on the blue banner.
            className={`w-10 h-10 rounded-full items-center justify-center ml-2 ${
              voiceMuted ? 'bg-warning' : 'bg-white/15'
            }`}
            accessibilityRole="button"
            accessibilityLabel={voiceMuted ? 'Unmute voice guidance' : 'Mute voice guidance'}
            accessibilityState={{ selected: !voiceMuted }}
          >
            {voiceMuted ? (
              <VolumeX size={20} color={LightColors.textPrimary} />
            ) : (
              <Volume2 size={20} color={LightColors.textInverse} />
            )}
          </Pressable>
          <Pressable
            onPress={handleEndNavigation}
            hitSlop={10}
            className="w-10 h-10 rounded-full bg-white/15 items-center justify-center ml-2"
            accessibilityRole="button"
            accessibilityLabel="End navigation"
          >
            <X size={18} color={LightColors.textInverse} />
          </Pressable>
        </View>

        {/* Destination subtitle \u2014 keeps the runner aware of where they're heading. */}
        <View className="mx-3 mt-1.5 rounded-xl bg-black/80 px-3 py-1.5 self-start">
          <Text
            className="text-white text-[12px] font-montserrat"
            numberOfLines={1}
          >
            {inPickupPhase ? 'Pickup' : 'Dropoff'}: {destLabel}
          </Text>
        </View>
      </SafeAreaView>

      {/* Greeting / trip summary card \u2014 fades in once the route is
          ready and auto-dismisses after 3.5s. Gives the runner a
          contextual welcome with phase + total distance + ETA before
          the maneuver banner takes over. Tap dismisses immediately. */}
      {showGreeting && navRoute && (
        <Animated.View
          pointerEvents="box-none"
          // Flows directly under the top SafeAreaView banner stack rather
          // than a fixed top:200, so its gap below the subtitle stays
          // constant across devices (Dynamic Island 59pt vs SE 20pt inset).
          style={{
            marginHorizontal: 12,
            marginTop: 12,
            opacity: greetingOpacity,
          }}
        >
          <Pressable
            onPress={dismissGreeting}
            accessibilityRole="button"
            accessibilityLabel="Dismiss trip summary"
            className="rounded-2xl bg-white px-4 py-3.5 flex-row items-center"
            style={Elevation.lg}
          >
            <View className={`w-11 h-11 rounded-full items-center justify-center mr-3 ${
              inPickupPhase ? 'bg-primary/15' : 'bg-danger/15'
            }`}>
              <MapPin size={20} color={inPickupPhase ? LightColors.primary : LightColors.dangerDark} strokeWidth={2.2} />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-montserrat-bold uppercase text-textTertiary" style={{ letterSpacing: 1.2 }}>
                Heading to {inPickupPhase ? 'pickup' : 'drop-off'}
              </Text>
              <Text className="text-[14px] font-montserrat-bold text-textPrimary mt-0.5" numberOfLines={2}>
                {destLabel}
              </Text>
              <View className="flex-row items-center mt-1">
                <Text
                  className="text-[12px] font-inter-semi text-primary"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {remainingDistance != null ? fmtDistance(remainingDistance) : '\u2014'}
                </Text>
                <View className="w-1 h-1 rounded-full bg-textTertiary/60 mx-1.5" />
                <Text
                  className="text-[12px] font-inter text-textSecondary"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {remainingDuration != null
                    ? `${fmtDuration(remainingDuration)} \u00b7 arrives ${fmtArrival(remainingDuration)}`
                    : 'Calculating\u2026'}
                </Text>
              </View>
            </View>
          </Pressable>
        </Animated.View>
      )}

      {/* Speed HUD — small chip in the bottom-left corner that mirrors
          the satnav convention. Only appears when the runner is
          actually moving so a stationary screen doesn't show 0 km/h.
          Anchored to the sheet's real peek edge (floatBottom) so the
          gap above the sheet is identical on SE / Pro Max / small Android. */}
      {speedKmh != null && (
        <View
          className="absolute left-4 bg-white rounded-2xl px-3.5 py-2.5 flex-row items-center"
          style={{ bottom: floatBottom, zIndex: 20, ...Elevation.md }}
        >
          {/* Gauge glyph + km/h unit make it unmistakably a speed readout,
              so the illegible 8px "SPEED" sub-label is dropped and the
              number carries the whole chip at a glanceable size. */}
          <Gauge size={15} color={LightColors.textMuted} strokeWidth={2.2} />
          <Text
            className="text-[24px] font-inter-semi text-textPrimary ml-1.5 leading-[26px]"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {speedKmh}
          </Text>
          <Text className="text-[11px] font-montserrat-semi text-textTertiary ml-1">
            km/h
          </Text>
        </View>
      )}

      {/* Recenter FAB — visible whenever course-follow is disengaged.
          Anchored to floatBottom (matches the speed HUD) so it always
          clears the sheet peek edge; zIndex pushes it above the sheet in
          case the absolute layering ever shifts. */}
      {!followCamera && (
        <Pressable
          onPress={() => setFollowCamera(true)}
          accessibilityRole="button"
          accessibilityLabel="Recenter map on your location"
          className="absolute right-4 w-12 h-12 rounded-full bg-white items-center justify-center"
          style={{ bottom: floatBottom, zIndex: 20, ...Elevation.md }}
        >
          <Locate size={22} color={LightColors.textPrimary} strokeWidth={2.2} />
        </Pressable>
      )}

      {/* Bottom panel — expandable ETA / step sheet */}
      <ExpandableSheet
        initial="peek"
        snapPoints={{ peek: SHEET_PEEK, half: 0.52, full: 0.90 }}
        reduceMotion={reducedMotion}
      >
        {/* ETA summary row — always visible at peek */}
        <View className="px-5 pt-2 pb-2">
          <View className="flex-row items-end justify-between">
            <View className="flex-1">
              <Text
                className="text-[28px] font-inter-semi text-textPrimary leading-tight"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {remainingDuration != null ? fmtDuration(remainingDuration) : '\u2014'}
              </Text>
              <Text
                className="text-[12px] font-inter text-textSecondary mt-0.5"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {remainingDistance != null ? fmtDistance(remainingDistance) : ''}
                {remainingDuration != null && remainingDistance != null ? ' \u00b7 ' : ''}
                {remainingDuration != null ? `arrives ${fmtArrival(remainingDuration)}` : ''}
              </Text>
            </View>
            {arrivedSoon ? (
              <Pressable
                onPress={handleArrived}
                accessibilityRole="button"
                accessibilityLabel="I've arrived"
                // successDark (#15803D) clears 4.5:1 with white at this
                // label size; larger label + target for a stopping glance.
                // rounded-xl (14) matches the app CTA corner, not a pill.
                className="px-6 rounded-xl bg-successDark ml-3 items-center justify-center"
                style={({ pressed }) => ({ minHeight: 48, opacity: pressed ? 0.9 : 1 })}
                android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
              >
                <Text className="text-white text-[15px] font-montserrat-bold">I&apos;ve Arrived</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleEndNavigation}
                accessibilityRole="button"
                accessibilityLabel="End navigation"
                className="px-6 rounded-xl bg-surfaceMuted border border-dividerStrong ml-3 items-center justify-center"
                style={({ pressed }) => ({ minHeight: 48, opacity: pressed ? 0.85 : 1 })}
                android_ripple={{ color: 'rgba(15,23,42,0.08)' }}
              >
                <Text className="text-textPrimary text-[15px] font-montserrat-bold">End</Text>
              </Pressable>
            )}
          </View>
          {routeError &&
            (!navRoute ? (
              // No usable route: recovery IS the primary action. Full-width
              // button in the always-visible peek zone so it can never fall
              // below the fold on a safety-critical screen.
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  void fetchNav();
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry route"
                className="mt-3 rounded-xl bg-primary items-center justify-center"
                style={({ pressed }) => ({
                  minHeight: 48,
                  opacity: pressed ? 0.9 : 1,
                })}
                android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
              >
                <Text className="text-white text-[15px] font-montserrat-bold">Retry route</Text>
              </Pressable>
            ) : (
              // Route still shown (a background refresh failed mid-trip):
              // a quieter pill is enough since the runner isn't blocked.
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  void fetchNav();
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry route"
                // The pill itself is ~30pt tall; hitSlop lifts the
                // effective target to >=44pt without inflating the visual.
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                className="mt-3 mb-1 self-center px-4 py-2 rounded-full bg-danger/10"
              >
                {/* dangerDark (#B91C1C) — base danger at 12px on the soft
                    wash measures ~3.6:1, below the 4.5:1 AA floor. */}
                <Text className="text-dangerDark text-[12px] font-montserrat-bold uppercase tracking-wider">
                  Retry route
                </Text>
              </Pressable>
            ))}
        </View>

        {/* Upcoming steps list — visible when sheet is expanded to half / full */}
        {navRoute && navRoute.steps.length > currentStepIdx + 1 && (
          <>
            <View style={{ height: 1, backgroundColor: LightColors.divider, marginHorizontal: 20, marginBottom: 4 }} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            >
              {navRoute.steps.slice(currentStepIdx + 1).map((step, idx) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: LightColors.divider }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: LightColors.surfaceMuted, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 }}>
                    <ManeuverIcon type={step.maneuverType} modifier={step.maneuverModifier} size={18} color={LightColors.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text className="text-[13px] font-montserrat-semi text-textPrimary" numberOfLines={2}>
                      {step.instruction}
                    </Text>
                    <Text
                      className="text-[12px] font-inter text-textTertiary mt-0.5"
                      style={{ fontVariant: ['tabular-nums'] }}
                    >
                      {fmtDistance(step.distanceMeters)}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </>
        )}
        <SafeAreaView edges={['bottom']} />
      </ExpandableSheet>

      {/* Single-tap arrival confirm — advances the status in place so the
          runner doesn't have to bounce back to the errand screen. */}
      <ConfirmModal
        visible={showArrivedPrompt}
        title="You've arrived — mark arrived?"
        message={`Let the customer know you've reached the ${
          inPickupPhase ? 'pickup' : 'drop-off'
        }. You can capture any required photo or PIN on the next step.`}
        confirmLabel="Mark arrived"
        confirmLoadingLabel="Marking…"
        cancelLabel="Not yet"
        loading={arriving}
        onConfirm={handleConfirmArrived}
        onCancel={() => setShowArrivedPrompt(false)}
      />
    </View>
  );
}
