import React from 'react';
import { Pressable, Linking, Platform } from 'react-native';
import { Navigation } from 'lucide-react-native';

interface NavigateButtonProps {
  lat: number;
  lng: number;
  /** Kept for callers that pass it (deep-link label / a11y); not rendered as text. */
  label?: string;
  /** Override absolute position. Defaults to bottom-right of the parent. */
  style?: any;
}

/**
 * Icon-only round FAB that opens turn-by-turn navigation in the
 * platform's preferred maps app. Text label removed by design — it
 * was duplicating the destination labels already shown elsewhere on
 * the screen.
 */
export function NavigateButton({ lat, lng, label, style }: NavigateButtonProps) {
  const handlePress = () => {
    const url = Platform.select({
      ios: `maps:?daddr=${lat},${lng}&dirflg=d`,
      android: `google.navigation:q=${lat},${lng}`,
    });

    if (url) {
      Linking.openURL(url).catch(() => {
        Linking.openURL(
          `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
        );
      });
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label ? `Navigate to ${label}` : 'Open navigation'}
      hitSlop={8}
      style={style}
      className="w-12 h-12 rounded-full bg-primary items-center justify-center shadow-md"
    >
      <Navigation size={20} color="#FFFFFF" />
    </Pressable>
  );
}
