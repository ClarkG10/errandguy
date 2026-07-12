import React from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import { Image } from 'expo-image';

/**
 * ErrandGuy wordmark lockup — the running mark + "ErrandGuy" set beside it.
 *
 * Uses the pre-trimmed `wordmark-lockup.png` (transparent, tightly cropped
 * to the artwork) so it can be sized purely by height: the intrinsic aspect
 * ratio drives the width, and `contentFit="contain"` keeps it crisp at any
 * density. Drop it into any brand moment (auth headers, empty states) with a
 * single `height` prop.
 */

// Intrinsic aspect (width / height) of assets/wordmark-lockup.png (2729×662).
const WORDMARK_ASPECT = 4.122;

interface WordmarkProps {
  /** Rendered height in points. Width derives from the intrinsic aspect. */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function Wordmark({ height = 36, style }: WordmarkProps) {
  return (
    <View
      style={[{ height, width: height * WORDMARK_ASPECT }, style]}
      accessibilityRole="image"
      accessibilityLabel="ErrandGuy"
    >
      <Image
        source={require('../../../assets/wordmark-lockup.png')}
        style={{ width: '100%', height: '100%' }}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
