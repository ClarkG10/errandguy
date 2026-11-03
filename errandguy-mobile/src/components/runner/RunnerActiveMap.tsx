import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { HereMapView, HereMarker, HerePolyline, type HereMapViewRef } from '../map';
import { Locate, Navigation } from 'lucide-react-native';
import { useLocationStore } from '../../stores/locationStore';
import { formatEtaMinutes } from '../../services/route.service';
import { useEta } from '../../hooks/useEta';
import { LightColors, Elevation } from '../../constants/colors';

interface RunnerActiveMapProps {
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  inPickupPhase: boolean;
  singleLocation?: boolean;
  etaMinutes?: number | null;
  variant?: 'card' | 'fill';
  bottomOffset?: number | Animated.Value | Animated.AnimatedInterpolation<number>;
  /**
   * False while the screen hosting the map is covered (turn-by-turn pushed on
   * top of the errand cockpit). The map then stops fetching routes and
   * re-fitting on every GPS fix nobody can see, and catches up on return.
   */
  active?: boolean;
}

export function RunnerActiveMap({
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  inPickupPhase,
  singleLocation = false,
  etaMinutes,
  variant = 'card',
  bottomOffset = 24,
  active = true,
}: RunnerActiveMapProps) {
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const mapRef = useRef<HereMapViewRef>(null);

  const toFiniteNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const pLat = toFiniteNum(pickupLat);
  const pLng = toFiniteNum(pickupLng);
  const dLat = toFiniteNum(dropoffLat);
  const dLng = toFiniteNum(dropoffLng);
  const myLng = toFiniteNum(currentLocation?.lng);
  const myLat = toFiniteNum(currentLocation?.lat);

  const destLat = inPickupPhase ? (pLat ?? dLat) : (dLat ?? pLat);
  const destLng = inPickupPhase ? (pLng ?? dLng) : (dLng ?? pLng);

  const hasRunner = myLng != null && myLat != null;
  const hasDest = destLat != null && destLng != null;
  const hasPickup = pLat != null && pLng != null;
  const hasDropoff = dLat != null && dLng != null;

  // Live ETA AND the drawn route for the leg this map shows, from ONE request.
  // Computed HERE — a leaf that already subscribes to currentLocation — rather
  // than in the ~1100-line parent errand screen, so a GPS fix re-renders only
  // this map instead of the whole errand tree. The polyline used to come from a
  // second effect asking routeService for the very same leg, so every ~110 m
  // the map paid for the same route twice. `etaMinutes` stays an optional
  // override for any caller that wants to supply its own. (P14)
  const eta = useEta(
    hasRunner ? { lat: myLat!, lng: myLng! } : null,
    hasDest ? { lat: destLat!, lng: destLng! } : null,
    'driving',
    { enabled: active },
  );
  const displayEta = etaMinutes ?? eta.minutes;

  const routeCoords = eta.coordinates;
  const routeMapCoords = useMemo(
    () => (routeCoords ?? []).map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    [routeCoords],
  );

  const fitBounds = useMemo(() => {
    if (!hasRunner || !hasDest) return undefined;
    const lats = [myLat!, destLat!];
    const lngs = [myLng!, destLng!];
    return [
      { latitude: Math.max(...lats), longitude: Math.max(...lngs) },
      { latitude: Math.min(...lats), longitude: Math.min(...lngs) },
    ];
  }, [hasRunner, hasDest, myLng, myLat, destLat, destLng]);

  const fallbackRegion = useMemo(() => {
    const lat = hasDest ? destLat! : hasRunner ? myLat! : 14.6;
    const lng = hasDest ? destLng! : hasRunner ? myLng! : 121.0;
    return { latitude: lat, longitude: lng, latitudeDelta: 0.04, longitudeDelta: 0.04 };
  }, [hasDest, hasRunner, myLng, myLat, destLat, destLng]);

  useEffect(() => {
    if (!active || !mapRef.current || !fitBounds) return;
    mapRef.current.fitToCoordinates(fitBounds, {
      edgePadding: { top: 50, bottom: 70, left: 50, right: 50 },
      animated: true,
    });
  }, [fitBounds, active]);

  const recenter = () => {
    if (!mapRef.current) return;
    if (fitBounds) {
      mapRef.current.fitToCoordinates(fitBounds, {
        edgePadding: { top: 50, bottom: 70, left: 50, right: 50 },
        animated: true,
      });
    } else if (hasRunner) {
      mapRef.current.animateToRegion(
        { latitude: myLat!, longitude: myLng!, latitudeDelta: 0.015, longitudeDelta: 0.015 },
        600,
      );
    }
  };

  if (!hasPickup && !hasDropoff && !hasRunner) {
    return (
      <View
        className={
          variant === 'fill'
            ? 'flex-1 bg-surfaceMuted items-center justify-center'
            : 'mx-5 h-48 bg-surfaceMuted rounded-2xl items-center justify-center mb-4'
        }
      >
        <Navigation size={28} color={LightColors.textMuted} />
        <Text className="text-xs font-montserrat text-textSecondary mt-2">
          Map unavailable
        </Text>
      </View>
    );
  }

  const containerCls =
    variant === 'fill'
      ? 'flex-1'
      : 'mx-5 h-56 rounded-2xl overflow-hidden mb-4 border border-divider';

  return (
    <View className={containerCls}>
      <HereMapView
        ref={mapRef}
        style={{ flex: 1 }}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        initialRegion={fallbackRegion}
      >
        {hasPickup && (
          <HereMarker coordinate={{ latitude: pLat!, longitude: pLng! }} anchor={{ x: 0.5, y: 0.5 }} id="pickup-marker">
            {/* A = pickup, B = drop-off. The letter (not just the blue vs
                red fill) is what keeps the two pins distinguishable in
                glare and for colour-blind runners. */}
            <View
              className={`w-7 h-7 rounded-full items-center justify-center border-2 border-white ${
                inPickupPhase ? 'bg-primary' : 'bg-primary/60'
              }`}
            >
              <Text className="text-white text-[12px] font-inter-semi leading-[14px]">A</Text>
            </View>
          </HereMarker>
        )}

        {hasDropoff && !singleLocation && (
          <HereMarker coordinate={{ latitude: dLat!, longitude: dLng! }} anchor={{ x: 0.5, y: 0.5 }} id="dropoff-marker">
            <View
              className={`w-7 h-7 rounded-full items-center justify-center border-2 border-white ${
                !inPickupPhase ? 'bg-danger' : 'bg-danger/60'
              }`}
            >
              <Text className="text-white text-[12px] font-inter-semi leading-[14px]">B</Text>
            </View>
          </HereMarker>
        )}

        {routeMapCoords.length > 0 && (
          <>
            <HerePolyline
              id="route-outline"
              coordinates={routeMapCoords}
              strokeColor={inPickupPhase ? LightColors.primary900 : LightColors.dangerDark}
              strokeWidth={8}
            />
            <HerePolyline
              id="route-fill"
              coordinates={routeMapCoords}
              strokeColor={inPickupPhase ? LightColors.primary500 : LightColors.danger}
              strokeWidth={5}
            />
          </>
        )}
      </HereMapView>

      {displayEta != null && (
        <Animated.View
          style={{
            position: 'absolute',
            left: 12,
            bottom: bottomOffset as unknown as number,
            backgroundColor: LightColors.surface,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            ...Elevation.md,
            zIndex: 20,
          }}
        >
          <Text className="text-[11px] font-montserrat-bold text-textPrimary">
            {/* Shared renderer — the local `${n} min` had no hour rollover,
                so a long cross-city leg read "95 min" here while the
                navigation bar for the same leg read "1h 35m". */}
            {formatEtaMinutes(Math.max(1, Math.round(displayEta)))} away
          </Text>
        </Animated.View>
      )}

      <Animated.View
        style={{
          position: 'absolute',
          right: 12,
          bottom: bottomOffset as unknown as number,
          zIndex: 20,
        }}
      >
        <Pressable
          onPress={recenter}
          accessibilityRole="button"
          accessibilityLabel="Recenter map on your location"
          hitSlop={8}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: LightColors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            ...Elevation.md,
          }}
        >
          <Locate size={20} color={LightColors.primaryDark} />
        </Pressable>
      </Animated.View>
    </View>
  );
}
