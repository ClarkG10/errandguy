import React from 'react';
import { View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LightColors, Elevation } from '../../constants/colors';

interface BottomActionBarProps extends ViewProps {
  /** Background color for the bar — defaults to surface white. */
  background?: string;
  /** Whether to draw the hairline divider on top. */
  divider?: boolean;
}

/**
 * Sticky bottom action bar that lifts above the OS gesture / nav bar
 * on Android (3-button + gesture) and the home indicator on iOS.
 *
 * Replaces the ad-hoc `absolute bottom-0 ... pb-8` pattern that was
 * repeated in 8+ screens — that hardcoded 32px of bottom padding wasn't
 * enough for Android phones with a 48dp 3-button nav bar, so primary
 * CTAs were getting clipped.
 */
export function BottomActionBar({
  children,
  background = LightColors.surface,
  divider = false,
  style,
  ...rest
}: BottomActionBarProps) {
  const insets = useSafeAreaInsets();
  // Always keep at least 12 px of breathing room even when the OS
  // reports zero inset (older Android with hardware nav, dev builds
  // without insets). Devices with a 3-button bar / gesture bar / home
  // indicator get their full inset on top of the bar padding.
  const bottom = Math.max(insets.bottom, 12);

  return (
    <View
      {...rest}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: background,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: bottom,
          borderTopWidth: divider ? 1 : 0,
          borderTopColor: LightColors.divider,
          // Soft diffuse lift replaces the hairline — the bar floats
          // above the content instead of being fenced off from it.
          ...Elevation.lg,
          shadowOffset: { width: 0, height: -10 },
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
