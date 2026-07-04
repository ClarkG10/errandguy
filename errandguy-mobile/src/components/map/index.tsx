/**
 * HERE Maps / MapLibre wrappers that mirror the react-native-maps API.
 *
 * Drop-in replacements for:
 *   MapView  →  HereMapView  (+ expose animateToRegion / animateCamera / fitToCoordinates via ref)
 *   Marker   →  HereMarker
 *   Polyline →  HerePolyline
 *   Circle   →  HereCircle
 *
 * Map tiles: HERE Raster Tiles API v3 (`explore.day` — rich, Google-Maps-like
 * style with POIs, road labels, terrain shading). Retina-aware: PPI is
 * chosen from PixelRatio.get() so labels are the right physical size on
 * every device (ppi=400 hard-coded made labels look huge on 2x/3x phones).
 * No Mapbox token needed — MapLibre renders HERE tiles directly.
 */
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { PixelRatio } from 'react-native';
import {
  Map,
  Camera,
  type CameraRef,
  UserLocation,
  GeoJSONSource,
  Layer,
  Marker,
} from '@maplibre/maplibre-react-native';
import { LightColors } from '../../constants/colors';

const HERE_API_KEY = process.env.EXPO_PUBLIC_HERE_API_KEY ?? '';

// Choose the HERE `ppi` that matches the device pixel density. HERE expects
// one of 72 / 100 / 200 / 250 / 320 / 400 — but only the plain `png8` path
// (no `size` path segment) is supported on the free/standard tier. We keep
// the helper so we can slot in ppi once the HERE account is upgraded to the
// `{size}/{fmt}` endpoint path.
function pickHerePpi(): 72 | 200 | 320 | 400 {
  const r = PixelRatio.get();
  if (r >= 3.5) return 400;
  if (r >= 2.5) return 320;
  if (r >= 1.5) return 200;
  return 72;
}

// HERE raster tiles style (MapLibre style JSON, inline).
//
// Style options:
//   • `explore.day`           — rich, Google-Maps-like, POIs + road labels (default)
//   • `explore.night`         — dark mode variant
//   • `explore.satellite.day` — satellite imagery
//   • `lite.day`              — minimalist (was the old default — too plain)
//   • `logistics.day`         — optimised for delivery/logistics use-cases
//
// IMPORTANT: The HERE Tiles v3 API requires the tile size to be the *path*
// segment before the format: `/v3/base/mc/{z}/{x}/{y}/{size}/{fmt}` for 512,
// but that path returns 404 on standard accounts. The working format is simply
// `/v3/base/mc/{z}/{x}/{y}/{fmt}?style=...` which serves 256px tiles (200 OK).
// Using `size=512` as a *query* parameter causes HTTP 400 (invalid param). We
// therefore use the simple path with `tileSize: 256`.
function buildHereStyle(apiKey: string): string {
  return JSON.stringify({
    version: 8,
    sources: {
      'here-raster': {
        type: 'raster',
        tiles: [
          `https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?style=explore.day&apiKey=${apiKey}`,
        ],
        tileSize: 256,
        maxzoom: 20,
        attribution: '© HERE Maps',
      },
    },
    layers: [{ id: 'background', type: 'raster', source: 'here-raster' }],
  });
}

const HERE_MAP_STYLE_JSON = buildHereStyle(HERE_API_KEY);

// ─── Coordinate conversion helpers ───────────────────────────────────────────

/** Convert latitude delta (react-native-maps) to MapLibre zoom level. */
function latDeltaToZoom(latDelta: number): number {
  return Math.log2(360 / Math.max(latDelta, 0.0001)) - 0.5;
}

/** Convert MapLibre zoom level back to approximate latitude delta. */
function zoomToLatDelta(zoom: number): number {
  return 360 / Math.pow(2, zoom + 0.5);
}

// ─── Public types ─────────────────────────────────────────────────────────────

/** Same shape as react-native-maps `Region`. */
export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Methods exposed on the HereMapView ref (mirrors react-native-maps MapView ref). */
export interface HereMapViewRef {
  animateToRegion: (region: Region, duration?: number) => void;
  animateCamera: (
    camera: {
      center?: { latitude: number; longitude: number };
      zoom?: number;
      pitch?: number;
    },
    options?: { duration?: number },
  ) => void;
  fitToCoordinates: (
    coords: { latitude: number; longitude: number }[],
    options?: {
      edgePadding?: { top: number; bottom: number; left: number; right: number };
      animated?: boolean;
    },
  ) => void;
}

// ─── HereMapView ─────────────────────────────────────────────────────────────

interface HereMapViewProps {
  style?: any;
  initialRegion?: Region;
  onRegionChange?: () => void;
  onRegionChangeComplete?: (region: Region) => void;
  onPress?: () => void;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
  showsUserLocation?: boolean;
  /** Ignored — MapLibre doesn't show a built-in "my location" button. */
  showsMyLocationButton?: boolean;
  /** Ignored — MapLibre doesn't show a compass overlay. */
  showsCompass?: boolean;
  /** Ignored — Android-only toolbar. */
  toolbarEnabled?: boolean;
  /** Called when the user manually pans/drags the map. */
  onPanDrag?: () => void;
  children?: React.ReactNode;
}

export const HereMapView = forwardRef<HereMapViewRef, HereMapViewProps>(
  (props, ref) => {
    const {
      style,
      initialRegion,
      onRegionChange,
      onRegionChangeComplete,
      onPress,
      scrollEnabled = true,
      zoomEnabled = true,
      rotateEnabled = true,
      pitchEnabled = true,
      showsUserLocation = false,
      onPanDrag,
      children,
    } = props;

    const cameraRef = useRef<CameraRef | null>(null);

    const initialCoord = initialRegion
      ? ([initialRegion.longitude, initialRegion.latitude] as [number, number])
      : ([121.0, 14.6] as [number, number]);
    const initialZoom = initialRegion
      ? latDeltaToZoom(initialRegion.latitudeDelta)
      : 14;

    useImperativeHandle(ref, () => ({
      animateToRegion(region: Region, duration = 500) {
        cameraRef.current?.flyTo({
          center: [region.longitude, region.latitude],
          zoom: latDeltaToZoom(region.latitudeDelta),
          duration,
        });
      },
      animateCamera(
        camera: { center?: { latitude: number; longitude: number }; zoom?: number; pitch?: number },
        options: { duration?: number } = {},
      ) {
        const duration = options.duration ?? 500;
        if (camera.center) {
          cameraRef.current?.flyTo({
            center: [camera.center.longitude, camera.center.latitude],
            zoom: camera.zoom,
            pitch: camera.pitch,
            duration,
          });
        } else if (camera.zoom !== undefined) {
          cameraRef.current?.zoomTo(camera.zoom, { duration });
        }
      },
      fitToCoordinates(
        coords: { latitude: number; longitude: number }[],
        options: {
          edgePadding?: { top: number; bottom: number; left: number; right: number };
          animated?: boolean;
        } = {},
      ) {
        if (coords.length === 0) return;
        const lats = coords.map((c) => c.latitude);
        const lngs = coords.map((c) => c.longitude);
        const p = options.edgePadding ?? { top: 50, bottom: 50, left: 50, right: 50 };
        cameraRef.current?.fitBounds(
          [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
          {
            padding: { top: p.top, right: p.right, bottom: p.bottom, left: p.left },
            duration: options.animated !== false ? 500 : 0,
          },
        );
      },
    }));

    const handleRegionChanging = useCallback(
      (event: any) => {
        // Fire onPanDrag only when the user physically moves the map
        if (event?.nativeEvent?.userInteraction) onPanDrag?.();
        onRegionChange?.();
      },
      [onRegionChange, onPanDrag],
    );

    const handleRegionDidChange = useCallback(
      (event: any) => {
        if (!onRegionChangeComplete) return;
        const nativeEvent = event?.nativeEvent ?? {};
        const [lng, lat] = (nativeEvent.center as [number, number]) ?? [0, 0];
        const zoom: number = nativeEvent.zoom ?? 14;
        const delta = zoomToLatDelta(zoom);
        onRegionChangeComplete({
          latitude: lat,
          longitude: lng,
          latitudeDelta: delta,
          longitudeDelta: delta,
        });
      },
      [onRegionChangeComplete],
    );

    return (
      <Map
        style={style}
        mapStyle={HERE_MAP_STYLE_JSON}
        dragPan={scrollEnabled}
        touchZoom={zoomEnabled}
        touchRotate={rotateEnabled}
        touchPitch={pitchEnabled}
        onRegionIsChanging={handleRegionChanging}
        onRegionDidChange={handleRegionDidChange}
        onPress={onPress ? () => onPress() : undefined}
        attribution={false}
        logo={false}
        compass={false}
        scaleBar={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: initialCoord,
            zoom: initialZoom,
          }}
        />
        {showsUserLocation && <UserLocation />}
        {children}
      </Map>
    );
  },
);

HereMapView.displayName = 'HereMapView';

// ─── HereMarker ──────────────────────────────────────────────────────────────

interface HereMarkerProps {
  coordinate: { latitude: number; longitude: number };
  /** Anchor point in [0-1] space. (0.5, 0.5) = center, (0.5, 1.0) = bottom-center. */
  anchor?: { x: number; y: number };
  /** Stable ID — required if the marker moves (e.g. runner location). */
  id?: string;
  children?: React.ReactNode;
}

/**
 * Convert legacy {x, y} anchor to v11 string anchor.
 * x: 0=left 0.5=center 1=right  /  y: 0=top 0.5=center 1=bottom
 */
function xyToAnchor(a: { x: number; y: number }): 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' {
  const { x, y } = a;
  if (y < 0.25) {
    if (x < 0.25) return 'top-left';
    if (x > 0.75) return 'top-right';
    return 'top';
  }
  if (y > 0.75) {
    if (x < 0.25) return 'bottom-left';
    if (x > 0.75) return 'bottom-right';
    return 'bottom';
  }
  if (x < 0.25) return 'left';
  if (x > 0.75) return 'right';
  return 'center';
}

export function HereMarker({ coordinate, anchor, children }: HereMarkerProps) {
  const anchorStr = anchor ? xyToAnchor(anchor) : 'center';
  return (
    <Marker lngLat={[coordinate.longitude, coordinate.latitude]} anchor={anchorStr}>
      <View>{children}</View>
    </Marker>
  );
}

// ─── HerePolyline ────────────────────────────────────────────────────────────

interface HerePolylineProps {
  /** Must be unique per map — used as the MapLibre source/layer ID prefix. */
  id: string;
  coordinates: { latitude: number; longitude: number }[];
  strokeColor?: string;
  strokeWidth?: number;
  lineJoin?: 'round' | 'miter' | 'bevel';
}

export function HerePolyline({
  id,
  coordinates,
  strokeColor = LightColors.primary,
  strokeWidth = 4,
  lineJoin = 'round',
}: HerePolylineProps) {
  // Memoise on a flat coord-string key. Using `coordinates` array reference
  // alone causes spurious source updates whenever the parent re-renders with
  // a new array literal that holds the same points — and skipping the dep
  // entirely (with the old eslint-disable) was a foot-gun.
  const coordsKey = useMemo(
    () => coordinates.map((c) => `${c.longitude.toFixed(6)},${c.latitude.toFixed(6)}`).join('|'),
    [coordinates],
  );

  const geoJson = useMemo(
    () => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: coordinates.map(
          (c) => [c.longitude, c.latitude] as [number, number],
        ),
      },
      properties: {},
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coordsKey],
  );

  if (coordinates.length < 2) return null;

  // NOTE: in maplibre-react-native v11 the `<Layer>` child gets its `source`
  // prop auto-injected by GeoJSONSource via cloneReactChildrenWithProps. We
  // ALSO pass `source` explicitly as a belt-and-braces guard — some bundler
  // setups (Hermes + Reanimated worklets) have been observed to swallow the
  // injected prop, leaving the layer orphaned and silently invisible.
  const sourceId = `${id}-src`;
  return (
    <GeoJSONSource id={sourceId} data={geoJson}>
      <Layer
        id={`${id}-layer`}
        type="line"
        source={sourceId}
        paint={{
          'line-color': strokeColor,
          'line-width': strokeWidth,
          'line-opacity': 1,
        }}
        layout={{
          'line-cap': 'round',
          'line-join': lineJoin,
          visibility: 'visible',
        }}
      />
    </GeoJSONSource>
  );
}

// ─── HereCircle ──────────────────────────────────────────────────────────────

interface HereCircleProps {
  id?: string;
  center: { latitude: number; longitude: number };
  /** Radius in metres. */
  radius: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

/** Generate a polygon approximating a geodesic circle. */
function makeCirclePolygon(
  lng: number,
  lat: number,
  radiusMeters: number,
  steps = 64,
): [number, number][] {
  const R = 6371000;
  const d = radiusMeters / R;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
        Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return coords;
}

export function HereCircle({
  id = 'circle',
  center,
  radius,
  fillColor = `${LightColors.primary}1F`,
  strokeColor = LightColors.primary,
  strokeWidth = 2,
}: HereCircleProps) {
  const circleId = `${id}-${center.latitude.toFixed(4)}-${center.longitude.toFixed(4)}`;
  const sourceId = `${circleId}-src`;

  const geoJson = useMemo(
    () => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [makeCirclePolygon(center.longitude, center.latitude, radius)],
      },
      properties: {},
    }),
    [center.longitude, center.latitude, radius],
  );

  return (
    <GeoJSONSource id={sourceId} data={geoJson}>
      <Layer
        id={`${circleId}-fill`}
        type="fill"
        source={sourceId}
        paint={{ 'fill-color': fillColor, 'fill-opacity': 1 }}
      />
      <Layer
        id={`${circleId}-stroke`}
        type="line"
        source={sourceId}
        paint={{ 'line-color': strokeColor, 'line-width': strokeWidth }}
      />
    </GeoJSONSource>
  );
}

// Re-export View so Marker children render correctly
import { View } from 'react-native';
