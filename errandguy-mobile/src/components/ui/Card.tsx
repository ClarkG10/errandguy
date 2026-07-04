import React from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';
import { LightColors, Elevation } from '../../constants/colors';

/**
 * Neutral container. Three tones cover every spot in the redesign:
 *
 *  - `default` — white surface, soft shadow. The standard card.
 *  - `tinted`  — washed-blue surface (primary50). Used for advisory
 *                blocks, info callouts, and home-screen featured tiles.
 *  - `outline` — transparent / surface, hairline blue border. For
 *                lighter visual weight inside dense lists.
 *
 * `padding` ladder mirrors the spacing scale so screens can swap
 * density without per-instance className overrides.
 */
type CardTone = 'default' | 'tinted' | 'outline';
type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  className?: string;
  /** Visual tone. */
  tone?: CardTone;
  /** Inner padding. Defaults to `md` (16px). */
  padding?: CardPadding;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

const TONE_CLASS: Record<CardTone, string> = {
  default: 'bg-surface',
  tinted: 'bg-primary50',
  outline: 'bg-surface border border-primary100',
};

const PADDING_CLASS: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
  xl: 'p-6',
};

export function Card({
  children,
  style,
  onPress,
  className = '',
  tone = 'default',
  padding = 'md',
  accessibilityLabel,
  accessibilityHint,
  testID,
}: CardProps) {
  // rounded-2xl (24px) — big soft corners on a white surface with a
  // diffuse Elevation.sm shadow are the core of the airy card language.
  const useShadow = tone === 'default';
  const cardClass = `${TONE_CLASS[tone]} rounded-2xl ${PADDING_CLASS[padding]} ${className}`;

  if (onPress) {
    return (
      <Pressable
        className={cardClass}
        style={({ pressed }) => [
          useShadow && Elevation.sm,
          // Subtle press feedback for tappable cards: a gentle scale-in
          // reads more tactile than opacity alone. Ripple on Android.
          pressed && { opacity: 0.96, transform: [{ scale: 0.98 }] },
          style,
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        android_ripple={{ color: `${LightColors.primary}1A` }}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View
      className={cardClass}
      style={[useShadow && Elevation.sm, style]}
      testID={testID}
    >
      {children}
    </View>
  );
}
