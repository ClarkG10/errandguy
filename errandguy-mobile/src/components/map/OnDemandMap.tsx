/**
 * OnDemandMap — a cost-saving gate around the HERE map.
 *
 * Maps are the app's most expensive surface: every mounted map streams HERE
 * raster tiles (billed per request). To keep spend down, customer-facing
 * screens should NOT show a live map by default. This component renders a
 * lightweight "preview" card with a call-to-action; the real `HereMapView`
 * (and any children — markers, polylines) is only mounted once the user taps
 * to open it, and unmounts again when closed — so no tiles load until the
 * customer explicitly asks for the map.
 *
 * Usage:
 *   <OnDemandMap label="Select on map" height={220}>
 *     {(close) => (
 *       <HereMapView ...>
 *         <HereMarker ... />
 *       </HereMapView>
 *     )}
 *   </OnDemandMap>
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { MapPin, X } from 'lucide-react-native';
import { LightColors, Elevation } from '../../constants/colors';

interface OnDemandMapProps {
  /** CTA label shown on the collapsed preview. */
  label?: string;
  /** Secondary line under the label. */
  hint?: string;
  /** Height of the map / preview area. */
  height?: number;
  /** Rounded corners for the container. */
  radius?: number;
  /** Render-prop for the map; receives a `close` callback to collapse again. */
  children: (close: () => void) => React.ReactNode;
  style?: ViewStyle;
  /** Start opened (rarely needed — defaults to collapsed to save tiles). */
  defaultOpen?: boolean;
}

export function OnDemandMap({
  label = 'Select on map',
  hint = 'Tap to open the map',
  height = 220,
  radius = 20,
  children,
  style,
  defaultOpen = false,
}: OnDemandMapProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.preview, { height, borderRadius: radius }, style]}
      >
        <View style={styles.iconChip}>
          <MapPin size={22} color={LightColors.primary} />
        </View>
        <Text style={styles.label}>{label}</Text>
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
      </Pressable>
    );
  }

  return (
    <View style={[{ height, borderRadius: radius, overflow: 'hidden' }, style]}>
      {children(() => setOpen(false))}
      <Pressable
        onPress={() => setOpen(false)}
        accessibilityRole="button"
        accessibilityLabel="Close map"
        hitSlop={8}
        style={styles.closeBtn}
      >
        <X size={20} color={LightColors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.primaryLight,
    borderWidth: 1,
    borderColor: LightColors.divider,
  },
  iconChip: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.surface,
    marginBottom: 10,
    ...Elevation.sm,
  },
  label: {
    color: LightColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    color: LightColors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.surface,
    ...Elevation.md,
  },
});
