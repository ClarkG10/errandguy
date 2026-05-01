import React, { useEffect } from 'react';
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

/**
 * Thin top-of-screen progress bar that animates whenever there's at
 * least one outstanding network request. Mounted once at the app root
 * via `ToastProvider` so every screen automatically gets the indicator
 * without per-screen wiring.
 *
 * Behaviour
 *  - Stays hidden when idle (no work, zero overhead).
 *  - Fades in and runs an indeterminate sweep while requests are in
 *    flight (we don't have per-request progress percentages, so a sweep
 *    is the honest UX).
 *  - Fades out smoothly when the counter returns to zero.
 */
export function ApiActivityBar() {
  const insets = useSafeAreaInsets();
  const busy = useApiActivityStore((s) => s.count > 0);

  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-1);

  useEffect(() => {
    if (busy) {
      opacity.value = withTiming(1, { duration: 150 });
      // Indeterminate sweep: slide a 40%-wide bar from -40% to 100%.
      translateX.value = -1;
      translateX.value = withRepeat(
        withSequence(
          withTiming(1.4, { duration: 1200, easing: Easing.inOut(Easing.cubic) }),
          withTiming(-1, { duration: 0 }),
        ),
        -1,
        false,
      );
    } else {
      opacity.value = withTiming(0, { duration: 250 });
      cancelAnimation(translateX);
    }
  }, [busy, opacity, translateX]);

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
    backgroundColor: 'rgba(37,99,235,0.12)',
  },
  bar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '40%',
    backgroundColor: '#2563EB',
    borderRadius: 2,
  },
});
