import React from 'react';
import { View, Pressable, StyleSheet, type ViewStyle } from 'react-native';

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
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

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

const shadow = StyleSheet.create({
  // Tightened, brand-tinted lift — lets the blue accents on the page
  // remain the focal point without competing with heavy card shadows.
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
});

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
  // 14px — matches the new global radius scale. Cards are calmer
  // containers; a hairline of white-on-background already does most
  // of the visual work, the radius just softens the edge.
  const useShadow = tone === 'default';
  const cardClass = `${TONE_CLASS[tone]} rounded-lg ${PADDING_CLASS[padding]} ${className}`;

  if (onPress) {
    return (
      <Pressable
        className={cardClass}
        style={({ pressed }) => [
          useShadow && shadow.card,
          // Subtle press feedback for tappable cards: slight inset feel
          // via opacity + tiny scale. Native ripple on Android.
          pressed && { opacity: 0.94, transform: [{ scale: 0.995 }] },
          style,
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        android_ripple={{ color: 'rgba(37,99,235,0.10)' }}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View
      className={cardClass}
      style={[useShadow && shadow.card, style]}
      testID={testID}
    >
      {children}
    </View>
  );
}
