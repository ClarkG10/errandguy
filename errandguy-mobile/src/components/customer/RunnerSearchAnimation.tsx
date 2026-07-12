import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors } from '../../constants/colors';

const DEFAULT_SIZE = 200;

// The radar sits on the brand-blue gradient, so rings must be white — a
// primary-blue stroke is the same hue as the backdrop and disappears.
const DEFAULT_RING_COLOR = LightColors.textInverse;

/* ─── Animated pulse ring ─── */
function PulseRing({ delay, size, color }: { delay: number; size: number; color: string }) {
  const scale = useSharedValue(0.3);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    const timeout = setTimeout(() => {
      scale.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
      opacity.value = withRepeat(
        withTiming(0, { duration: 2000, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    }, delay);
    return () => clearTimeout(timeout);
  }, [delay, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          backgroundColor: `${color}1A`,
        },
        style,
      ]}
    />
  );
}

interface RunnerSearchAnimationProps {
  /** Ring diameter (px). Default 200 — matches the book/confirm radar. */
  size?: number;
  /** Ring stroke/fill hue. Default white (for the brand-gradient backdrop). */
  color?: string;
}

/**
 * The "searching" radar — three staggered expanding rings over a center dot,
 * fills its parent (absolute) and centers itself. Runs for the whole wait
 * (up to ~5 min in negotiate mode); under Reduce Motion it collapses to a
 * single static ring so the reanimated loops never start.
 *
 * Extracted from book/confirm.tsx so tracking/[id].tsx's identical
 * pre-dispatch radar can share one implementation. Geometry is unchanged.
 */
export function RunnerSearchAnimation({
  size = DEFAULT_SIZE,
  color = DEFAULT_RING_COLOR,
}: RunnerSearchAnimationProps) {
  const reduceMotion = useReducedMotion();
  return (
    <View style={styles.container} pointerEvents="none">
      {reduceMotion ? (
        <View
          style={[
            styles.staticRing,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: color,
              backgroundColor: `${color}1A`,
            },
          ]}
        />
      ) : (
        <>
          <PulseRing delay={0} size={size} color={color} />
          <PulseRing delay={700} size={size} color={color} />
          <PulseRing delay={1400} size={size} color={color} />
        </>
      )}
      {/* Center dot */}
      <View style={styles.centerDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Reduce-Motion replacement for the pulse rings — one still ring keeps the
  // radar framing without any animation. Same geometry as the animated rings
  // at full scale so the center-dot alignment matches.
  staticRing: {
    position: 'absolute',
    borderWidth: 2,
    opacity: 0.6,
  },
  centerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: LightColors.surface,
    elevation: 4,
    shadowColor: LightColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
  },
});
