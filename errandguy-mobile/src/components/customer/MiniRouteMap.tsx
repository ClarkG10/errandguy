import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { MapPin } from 'lucide-react-native';
import Mapbox from '@rnmapbox/maps';
import { MAP_STYLE_URL } from '../../constants/map';
import { routeService } from '../../services/route.service';

interface MiniRouteMapProps {
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  pickupAddress?: string;
  dropoffAddress?: string;
}

export function MiniRouteMap({
  pickupLat: pickupLatRaw,
  pickupLng: pickupLngRaw,
  dropoffLat: dropoffLatRaw,
  dropoffLng: dropoffLngRaw,
  pickupAddress,
  dropoffAddress,
}: MiniRouteMapProps) {
  // API may return decimal columns as strings; coerce to numbers because
  // @rnmapbox/maps strictly requires Double for coordinates.
  const pickupLat = pickupLatRaw != null ? Number(pickupLatRaw) : undefined;
  const pickupLng = pickupLngRaw != null ? Number(pickupLngRaw) : undefined;
  const dropoffLat = dropoffLatRaw != null ? Number(dropoffLatRaw) : undefined;
  const dropoffLng = dropoffLngRaw != null ? Number(dropoffLngRaw) : undefined;

  const hasPickup =
    pickupLat != null && pickupLng != null &&
    Number.isFinite(pickupLat) && Number.isFinite(pickupLng);
  const hasDropoff =
    dropoffLat != null && dropoffLng != null &&
    Number.isFinite(dropoffLat) && Number.isFinite(dropoffLng);
  const hasBoth = hasPickup && hasDropoff;

  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  // Fetch directions via shared cached service. The mini route map is
  // rendered inside booking history list rows and confirm screens — the
  // same coordinate pair often gets requested many times per session,
  // so the AsyncStorage layer is a real bandwidth + cost win.
  useEffect(() => {
    if (!hasBoth) return;
    let cancelled = false;
    routeService
      .getRoute(
        { lng: pickupLng!, lat: pickupLat! },
        { lng: dropoffLng!, lat: dropoffLat! },
      )
      .then((res) => {
        if (cancelled || !res) return;
        setRouteCoords(res.coordinates);
      });
    return () => { cancelled = true; };
  }, [hasBoth, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const routeGeoJSON = useMemo(() => {
    if (routeCoords.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: routeCoords,
      },
    };
  }, [routeCoords]);

  // Camera bounds
  const bounds = useMemo(() => {
    if (!hasBoth) return undefined;
    const lngs = [pickupLng!, dropoffLng!];
    const lats = [pickupLat!, dropoffLat!];
    return {
      ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
      sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
      paddingTop: 40,
      paddingBottom: 40,
      paddingLeft: 40,
      paddingRight: 40,
    };
  }, [hasBoth, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const center = hasPickup
    ? [pickupLng!, pickupLat!]
    : hasDropoff
      ? [dropoffLng!, dropoffLat!]
      : [121.0, 14.6]; // Manila default

  if (!hasPickup && !hasDropoff) return null;

  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Route Preview
      </Text>
      <View className="h-40 rounded-xl overflow-hidden">
        <Mapbox.MapView
          style={{ flex: 1 }}
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
            {...(bounds
              ? { bounds }
              : { centerCoordinate: center as [number, number], zoomLevel: 14 }
            )}
            animationMode="none"
          />

          {/* Pickup marker */}
          {hasPickup && (
            <Mapbox.MarkerView id="pickup" coordinate={[pickupLng!, pickupLat!]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
              <View className="w-6 h-6 rounded-full bg-primary items-center justify-center border-2 border-white">
                <View className="w-2 h-2 rounded-full bg-white" />
              </View>
            </Mapbox.MarkerView>
          )}

          {/* Dropoff marker */}
          {hasDropoff && (
            <Mapbox.MarkerView id="dropoff" coordinate={[dropoffLng!, dropoffLat!]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
              <View className="w-6 h-6 rounded-full bg-danger items-center justify-center border-2 border-white">
                <View className="w-2 h-2 rounded-full bg-white" />
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

        {/* Address overlay */}
        <View className="absolute bottom-0 left-0 right-0 bg-surface/90 px-3 py-2">
          {hasPickup && pickupAddress && (
            <View className="flex-row items-center mb-1">
              <MapPin size={12} color="#2563EB" />
              <Text
                className="text-[10px] font-montserrat text-textPrimary ml-1 flex-1"
                numberOfLines={1}
              >
                {pickupAddress}
              </Text>
            </View>
          )}
          {hasDropoff && dropoffAddress && (
            <View className="flex-row items-center">
              <MapPin size={12} color="#EF4444" />
              <Text
                className="text-[10px] font-montserrat text-textPrimary ml-1 flex-1"
                numberOfLines={1}
              >
                {dropoffAddress}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
