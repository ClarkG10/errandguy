import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Locate, Navigation } from 'lucide-react-native';
import Mapbox from '@rnmapbox/maps';
import { MAP_STYLE_URL } from '../../constants/map';
import { useLocationStore } from '../../stores/locationStore';
import { routeService } from '../../services/route.service';

interface RunnerActiveMapProps {
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  /** Whether the runner is still in the pickup phase (decides which
   *  destination to draw a route to and which marker to highlight). */
  inPickupPhase: boolean;
  /** When true, render only one destination marker (queue / bills). */
  singleLocation?: boolean;
  /** Approx ETA shown as overlay (minutes). Optional. */
  etaMinutes?: number | null;
}

/**
 * Compact live map for the runner's active errand.
 *
 * Shows the runner's current device location (pulsing blue dot) plus
 * pickup/dropoff markers and a routed line to whichever destination
 * matters right now. Pure UI — the upstream `locationStore` already
 * watches the GPS via `Location.watchPositionAsync` and pushes updates
 * to the backend, so this component only consumes the cached value.
 */
export function RunnerActiveMap({
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  inPickupPhase,
  singleLocation = false,
  etaMinutes,
}: RunnerActiveMapProps) {
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const cameraRef = React.useRef<Mapbox.Camera>(null);

  // Resolve the active destination based on phase.
  const destLat = inPickupPhase ? pickupLat : dropoffLat;
  const destLng = inPickupPhase ? pickupLng : dropoffLng;

  const hasRunner = currentLocation != null;
  const hasDest = destLat != null && destLng != null;
  const hasPickup = pickupLat != null && pickupLng != null;
  const hasDropoff = dropoffLat != null && dropoffLng != null;

  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  // Fetch driving directions from runner → active destination. Re-runs
  // when the destination flips (pickup → dropoff) or when the runner
  // moves >300m from the previous fetch (cheap snap to grid).
  const runnerKey = useMemo(() => {
    if (!currentLocation) return '';
    // Round to ~3 decimals (~110m) so we don't refetch every GPS tick.
    return `${currentLocation.lat.toFixed(3)},${currentLocation.lng.toFixed(3)}`;
  }, [currentLocation]);

  useEffect(() => {
    if (!hasRunner || !hasDest) return;
    let cancelled = false;
    routeService
      .getRoute(
        { lng: currentLocation!.lng, lat: currentLocation!.lat },
        { lng: destLng!, lat: destLat! },
      )
      .then((res) => {
        if (cancelled || !res) return;
        setRouteCoords(res.coordinates);
      });
    return () => {
      cancelled = true;
    };
    // currentLocation intentionally excluded — runnerKey covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerKey, destLat, destLng, hasRunner, hasDest]);

  const routeGeoJSON = useMemo(() => {
    if (routeCoords.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: routeCoords },
    };
  }, [routeCoords]);

  // Camera bounds covering both runner and active destination.
  const bounds = useMemo(() => {
    if (!hasRunner || !hasDest) return undefined;
    const lngs = [currentLocation!.lng, destLng!];
    const lats = [currentLocation!.lat, destLat!];
    return {
      ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
      sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
      paddingTop: 50,
      paddingBottom: 70,
      paddingLeft: 50,
      paddingRight: 50,
    };
  }, [hasRunner, hasDest, currentLocation, destLat, destLng]);

  const fallbackCenter = useMemo<[number, number]>(() => {
    if (hasDest) return [destLng!, destLat!];
    if (hasRunner) return [currentLocation!.lng, currentLocation!.lat];
    return [121.0, 14.6]; // Manila
  }, [hasDest, hasRunner, currentLocation, destLat, destLng]);

  const recenter = () => {
    if (!cameraRef.current) return;
    if (bounds) {
      cameraRef.current.fitBounds(bounds.ne, bounds.sw, [50, 50, 70, 50], 600);
    } else if (hasRunner) {
      cameraRef.current.setCamera({
        centerCoordinate: [currentLocation!.lng, currentLocation!.lat],
        zoomLevel: 15,
        animationDuration: 600,
      });
    }
  };

  if (!hasPickup && !hasDropoff && !hasRunner) {
    return (
      <View className="mx-5 h-48 bg-gray-100 rounded-2xl items-center justify-center mb-4">
        <Navigation size={28} color="#94A3B8" />
        <Text className="text-xs font-montserrat text-textSecondary mt-2">
          Map unavailable
        </Text>
      </View>
    );
  }

  return (
    <View className="mx-5 h-56 rounded-2xl overflow-hidden mb-4 border border-divider">
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
          {...(bounds
            ? { bounds }
            : { centerCoordinate: fallbackCenter, zoomLevel: 14 })}
          animationMode="easeTo"
          animationDuration={500}
        />

        {/* Pickup marker (only when not single-location, or when in pickup
            phase for single-location to indicate the task spot). */}
        {hasPickup && (
          <Mapbox.MarkerView
            id="r-pickup"
            coordinate={[pickupLng!, pickupLat!]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View
              className={`w-7 h-7 rounded-full items-center justify-center border-2 border-white ${
                inPickupPhase ? 'bg-primary' : 'bg-primary/60'
              }`}
            >
              <View className="w-2 h-2 rounded-full bg-white" />
            </View>
          </Mapbox.MarkerView>
        )}

        {/* Dropoff marker — hidden for single-location errands. */}
        {hasDropoff && !singleLocation && (
          <Mapbox.MarkerView
            id="r-dropoff"
            coordinate={[dropoffLng!, dropoffLat!]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View
              className={`w-7 h-7 rounded-full items-center justify-center border-2 border-white ${
                !inPickupPhase ? 'bg-danger' : 'bg-danger/60'
              }`}
            >
              <View className="w-2 h-2 rounded-full bg-white" />
            </View>
          </Mapbox.MarkerView>
        )}

        {/* Runner live marker */}
        {hasRunner && (
          <Mapbox.MarkerView
            id="r-self"
            coordinate={[currentLocation!.lng, currentLocation!.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View className="w-8 h-8 rounded-full bg-blue-500/30 items-center justify-center">
              <View className="w-4 h-4 rounded-full bg-blue-600 border-2 border-white" />
            </View>
          </Mapbox.MarkerView>
        )}

        {/* Route line runner → active destination */}
        {routeGeoJSON && (
          <Mapbox.ShapeSource id="r-route" shape={routeGeoJSON}>
            <Mapbox.LineLayer
              id="r-route-line"
              style={{
                lineColor: inPickupPhase ? '#2563EB' : '#DC2626',
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>

      {/* ETA pill */}
      {etaMinutes != null && (
        <View className="absolute top-3 left-3 bg-surface/95 px-3 py-1.5 rounded-full shadow-sm">
          <Text className="text-[11px] font-montserrat-bold text-textPrimary">
            {Math.max(1, Math.round(etaMinutes))} min away
          </Text>
        </View>
      )}

      {/* Recenter FAB */}
      <Pressable
        onPress={recenter}
        className="absolute top-3 right-3 w-9 h-9 rounded-full bg-surface items-center justify-center shadow-sm"
        hitSlop={6}
      >
        <Locate size={16} color="#0F172A" />
      </Pressable>
    </View>
  );
}
