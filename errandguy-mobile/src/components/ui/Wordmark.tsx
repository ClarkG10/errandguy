import React from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import { Image } from 'expo-image';

/**
 * ErrandGuy wordmark — the custom two-tone "Errand" / "Guy" lockup.
 *
 * Two pre-trimmed, transparent variants (sized purely by `height`; the
 * intrinsic aspect drives the width, and `contentFit="contain"` keeps it
 * crisp at any density):
 *   • `horizontal` (default) — one line, for wide brand moments (headers).
 *   • `stacked` — "Errand" over "Guy", for centred / square-ish moments
 *     (the login hero). Set a larger `height` since it's two lines.
 */

// Intrinsic aspect (width / height) of each trimmed asset.
const WORDMARK_ASPECT = {
  horizontal: 3.303, // wordmark-lockup.png (2510×760)
  stacked: 1.296, // wordmark-stacked.png (600×463)
} as const;

const WORDMARK_SOURCE = {
  horizontal: require('../../../assets/wordmark-lockup.png'),
  stacked: require('../../../assets/wordmark-stacked.png'),
} as const;

interface WordmarkProps {
  /** Rendered height in points. Width derives from the intrinsic aspect. */
  height?: number;
  /** `horizontal` (one line, default) or `stacked` (Errand over Guy). */
  variant?: keyof typeof WORDMARK_ASPECT;
  style?: StyleProp<ViewStyle>;
}

export function Wordmark({ height = 36, variant = 'horizontal', style }: WordmarkProps) {
  return (
    <View
      style={[{ height, width: height * WORDMARK_ASPECT[variant] }, style]}
      accessibilityRole="image"
      accessibilityLabel="ErrandGuy"
    >
      <Image
        source={WORDMARK_SOURCE[variant]}
        style={{ width: '100%', height: '100%' }}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
