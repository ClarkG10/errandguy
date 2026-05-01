import React from 'react';
import { View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  background = '#F8FAFC',
  divider = true,
  style,
  ...rest
}: BottomActionBarProps) {
  const insets = useSafeAreaInsets();
  // Always keep at least 12 px of breathing room even when the OS
  // reports zero inset (older Android, dev builds without insets).
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
          paddingTop: 14,
          paddingBottom: bottom,
          borderTopWidth: divider ? 1 : 0,
          borderTopColor: '#E2E8F0',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
