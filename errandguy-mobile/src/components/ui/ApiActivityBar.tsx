import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApiActivityStore } from '../../stores/apiActivityStore';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors } from '../../constants/colors';

/**
 * Thin top-of-screen progress bar that animates whenever there's at
 * least one outstanding network request lasting longer than the
 * SHOW_DELAY threshold. Mounted once at the app root via
 * `ToastProvider` so every screen automatically gets the indicator
 * without per-screen wiring.
 *
 * Behaviour
 *  - Stays hidden when idle (no work, zero overhead).
 *  - Hidden for fast requests (< 800 ms). Cache hits, dedupes, and
 *    healthy single-server-roundtrips never show the bar — the
 *    perceived UX is "instant".
 *  - Fades in only after the network has been busy for 800 ms+.
 *  - Fades out smoothly when the counter returns to zero.
 *  - Background pollers (location pings, unread-count refreshes,
 *    realtime fallbacks, ETA refresh, errand sync) opt out entirely
 *    via `silent: true` in their axios config so they don't blip the
 *    bar.
 */
const SHOW_DELAY_MS = 800;

export function ApiActivityBar() {
  const insets = useSafeAreaInsets();
  const busy = useApiActivityStore((s) => s.count > 0);
  const reduceMotion = useReducedMotion();

  // Visible only after busy has been continuously true for SHOW_DELAY_MS.
  // Without this, every fast request blinked the bar for ~150 ms which
  // made the app feel like it was constantly loading even when most
  // calls return well under 400 ms.
  const [shouldShow, setShouldShow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setShouldShow(false);
      return;
    }
    const t = setTimeout(() => setShouldShow(true), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [busy]);

  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-1);

  useEffect(() => {
    if (shouldShow) {
      opacity.value = withTiming(1, { duration: 150 });
      translateX.value = -1;
      if (reduceMotion) {
        // Reduce-Motion: freeze the indeterminate sweep to a static 40% bar
        // (same accessibility stance as <ProgressBar> / <Skeleton>). The
        // opacity fade-in/out stays — only the looping translate is gated.
        cancelAnimation(translateX);
        translateX.value = 0;
      } else {
        // Indeterminate sweep: slide a 40%-wide bar from -40% to 100%.
        translateX.value = withRepeat(
          withSequence(
            withTiming(1.4, { duration: 1200, easing: Easing.inOut(Easing.cubic) }),
            withTiming(-1, { duration: 0 }),
          ),
          -1,
          false,
        );
      }
    } else {
      opacity.value = withTiming(0, { duration: 250 });
      cancelAnimation(translateX);
    }
  }, [shouldShow, opacity, translateX, reduceMotion]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${translateX.value * 100}%` as any }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { top: insets.top },
        containerStyle,
      ]}
    >
      <View style={styles.track} />
      <Animated.View style={[styles.bar, barStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2.5,
    overflow: 'hidden',
    zIndex: 9999,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: `${LightColors.primary}1F`,
  },
  bar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '40%',
    backgroundColor: LightColors.primary,
    borderRadius: 2,
  },
});
