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
  /**
   * 'card' (default) renders a rounded inset map with margin — used
   * when embedded between other content. 'fill' renders edge-to-edge
   * with no border/margin, intended for full-screen layouts where the
   * map is the background and other UI is overlaid.
   */
  variant?: 'card' | 'fill';
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
  variant = 'card',
}: RunnerActiveMapProps) {
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const cameraRef = React.useRef<Mapbox.Camera>(null);

  // Postgres `numeric` columns serialise as strings ("14.5995") in
  // Laravel API responses unless the model explicitly casts them. The
  // native Mapbox bindings reject string-typed coordinates with a
  // "Expected to decode Double but found a string" error and the map
  // crashes. Coerce + validate every coord here, once, so every render
  // path below sees a finite number or null.
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

  // Resolve the active destination based on phase. If the runner is
  // supposed to be in pickup phase but pickup is missing (shouldn't
  // happen for any current errand type but we guard anyway), fall
  // back to dropoff so the map still draws something useful.
  const destLat = inPickupPhase ? (pLat ?? dLat) : (dLat ?? pLat);
  const destLng = inPickupPhase ? (pLng ?? dLng) : (dLng ?? pLng);

  const hasRunner = myLng != null && myLat != null;
  const hasDest = destLat != null && destLng != null;
  const hasPickup = pLat != null && pLng != null;
  const hasDropoff = dLat != null && dLng != null;

  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  // Fetch driving directions from runner → active destination. Re-runs
  // when the destination flips (pickup → dropoff) or when the runner
  // moves >300m from the previous fetch (cheap snap to grid).
  const runnerKey = useMemo(() => {
    if (!hasRunner) return '';
    // Round to ~3 decimals (~110m) so we don't refetch every GPS tick.
    return `${myLat!.toFixed(3)},${myLng!.toFixed(3)}`;
  }, [hasRunner, myLat, myLng]);

  useEffect(() => {
    if (!hasRunner || !hasDest) return;
    let cancelled = false;
    routeService
      .getRoute(
        { lng: myLng!, lat: myLat! },
        { lng: destLng!, lat: destLat! },
      )
      .then((res) => {
        if (cancelled || !res) return;
        setRouteCoords(res.coordinates);
      });
    return () => {
      cancelled = true;
    };
    // myLng/myLat intentionally excluded — runnerKey covers it.
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
    const lngs = [myLng!, destLng!];
    const lats = [myLat!, destLat!];
    return {
      ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
      sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
      paddingTop: 50,
      paddingBottom: 70,
      paddingLeft: 50,
      paddingRight: 50,
    };
  }, [hasRunner, hasDest, myLng, myLat, destLat, destLng]);

  const fallbackCenter = useMemo<[number, number]>(() => {
    if (hasDest) return [destLng!, destLat!];
    if (hasRunner) return [myLng!, myLat!];
    return [121.0, 14.6]; // Manila
  }, [hasDest, hasRunner, myLng, myLat, destLat, destLng]);

  const recenter = () => {
    if (!cameraRef.current) return;
    if (bounds) {
      cameraRef.current.fitBounds(bounds.ne, bounds.sw, [50, 50, 70, 50], 600);
    } else if (hasRunner) {
      cameraRef.current.setCamera({
        centerCoordinate: [myLng!, myLat!],
        zoomLevel: 15,
        animationDuration: 600,
      });
    }
  };

  if (!hasPickup && !hasDropoff && !hasRunner) {
    return (
      <View
        className={
          variant === 'fill'
            ? 'flex-1 bg-gray-100 items-center justify-center'
            : 'mx-5 h-48 bg-gray-100 rounded-2xl items-center justify-center mb-4'
        }
      >
        <Navigation size={28} color="#94A3B8" />
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
            coordinate={[pLng!, pLat!]}
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
            coordinate={[dLng!, dLat!]}
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
            coordinate={[myLng!, myLat!]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View className="w-8 h-8 rounded-full bg-blue-500/30 items-center justify-center">
              <View className="w-4 h-4 rounded-full bg-blue-600 border-2 border-white" />
            </View>
          </Mapbox.MarkerView>
        )}

        {/* Route line runner → active destination.
            Cased layer (dark outline + bright fill) keeps the polyline
            legible on busy/satellite tiles where a single solid line
            would disappear into the underlying road geometry. */}
        {routeGeoJSON && (
          <Mapbox.ShapeSource id="r-route" shape={routeGeoJSON}>
            <Mapbox.LineLayer
              id="r-route-casing"
              style={{
                lineColor: inPickupPhase ? '#1E3A8A' : '#7F1D1D',
                lineWidth: 8,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: 0.95,
              }}
            />
            <Mapbox.LineLayer
              id="r-route-line"
              style={{
                lineColor: inPickupPhase ? '#3B82F6' : '#EF4444',
                lineWidth: 5,
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
