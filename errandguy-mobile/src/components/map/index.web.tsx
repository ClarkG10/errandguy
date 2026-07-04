/**
 * Web stub for the HERE / MapLibre map wrappers.
 *
 * `@maplibre/maplibre-react-native` is a native-only module — it calls
 * `codegenNativeComponent`, which react-native-web does not implement, so
 * importing it on web crashes the whole bundle at module-eval time.
 *
 * Metro resolves `index.web.tsx` ahead of `index.tsx` for the web platform,
 * so every `import ... from '@/components/map'` transparently gets these
 * lightweight placeholders on web. No maps are rendered on web (and therefore
 * no HERE tiles are ever requested from a browser), which also keeps map-API
 * usage down. The public API mirrors `index.tsx` exactly so screens compile
 * and run unchanged.
 */
import React, { forwardRef, useImperativeHandle } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LightColors } from '../../constants/colors';

// ─── Public types (mirror the native module) ─────────────────────────────────

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

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
  showsMyLocationButton?: boolean;
  showsCompass?: boolean;
  toolbarEnabled?: boolean;
  onPanDrag?: () => void;
  children?: React.ReactNode;
}

// ─── Placeholder components ──────────────────────────────────────────────────

export const HereMapView = forwardRef<HereMapViewRef, HereMapViewProps>(
  ({ style, children }, ref) => {
    useImperativeHandle(ref, () => ({
      animateToRegion() {},
      animateCamera() {},
      fitToCoordinates() {},
    }));
    return (
      <View style={[styles.placeholder, style]}>
        <Text style={styles.label}>Map is available in the mobile app</Text>
        {children}
      </View>
    );
  },
);

HereMapView.displayName = 'HereMapView';

export function HereMarker(_props: {
  coordinate: { latitude: number; longitude: number };
  anchor?: { x: number; y: number };
  id?: string;
  children?: React.ReactNode;
}) {
  return null;
}

export function HerePolyline(_props: {
  id: string;
  coordinates: { latitude: number; longitude: number }[];
  strokeColor?: string;
  strokeWidth?: number;
  lineJoin?: 'round' | 'miter' | 'bevel';
}) {
  return null;
}

export function HereCircle(_props: {
  id?: string;
  center: { latitude: number; longitude: number };
  radius: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}) {
  return null;
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.surfaceMuted,
  },
  label: {
    color: LightColors.textMuted,
    fontSize: 13,
  },
});
