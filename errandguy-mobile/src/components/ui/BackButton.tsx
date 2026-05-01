import React from 'react';
import { Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

interface BackButtonProps {
  /** Where to fall back to when there's nothing on the navigation stack. */
  fallbackHref?: string;
  /** Override the default `router.back()` behaviour entirely. */
  onPress?: () => void;
  /** Visual size — `sm` matches headers tucked into a row of small controls. */
  size?: 'sm' | 'md';
  accessibilityLabel?: string;
  /** Used when the navigation action is destructive (e.g. discard a draft). */
  accessibilityHint?: string;
  className?: string;
}

/**
 * Standardised back chevron used across all secondary screens.
 *
 * Why this exists:
 * - Centralises tap-target size, hitSlop, soft shadow, and the
 *   accessibilityRole/Label/Hint that were missing or inconsistent
 *   across 17+ screens.
 * - Adds a subtle native press feedback (scale on iOS, ripple on Android)
 *   so the chevron feels tactile rather than flat.
 * - Falls back to a known route when the navigation stack is empty
 *   (e.g. the user deep-linked into the screen) so the button never
 *   becomes a dead end.
 */
export function BackButton({
  fallbackHref,
  onPress,
  size = 'md',
  accessibilityLabel = 'Go back',
  accessibilityHint,
  className,
}: BackButtonProps) {
  const router = useRouter();
  const dimension = size === 'sm' ? 'w-9 h-9' : 'w-10 h-10';

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (fallbackHref) {
      router.replace(fallbackHref as any);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={8}
      android_ripple={
        Platform.OS === 'android'
          ? { color: 'rgba(15,23,42,0.08)', borderless: true, radius: 22 }
          : undefined
      }
      style={({ pressed }) => [
        {
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 6,
          elevation: 1,
        },
        Platform.OS === 'ios' && pressed
          ? { opacity: 0.7, transform: [{ scale: 0.94 }] }
          : null,
      ]}
      className={`${dimension} rounded-xl bg-surface items-center justify-center ${className ?? ''}`}
    >
      <ArrowLeft size={20} color="#0F172A" />
    </Pressable>
  );
}
