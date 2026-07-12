import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors } from '../../constants/colors';

interface SuccessCheckProps {
  /** Diameter of the circle in px. Defaults to 96. */
  size?: number;
  /** Circle fill colour. Defaults to the success token. */
  color?: string;
  /** Fire a lightweight confetti burst (12 animated dots) around the
   *  circle. Pure Views + reanimated — no extra deps. */
  celebrate?: boolean;
  /** Success notification haptic on mount. Defaults to true. */
  haptic?: boolean;
  /** Called once the intro animation has settled (~900ms; immediately
   *  under Reduce Motion). */
  onDone?: () => void;
  testID?: string;
}

/**
 * Animated success checkmark for completion moments (payment done,
 * errand completed, payout requested). The circle springs in, then the
 * check pops with a slight overshoot. Optional confetti burst for the
 * few genuinely celebratory moments — keep it off for routine saves.
 *
 * Respects the OS "Reduce Motion" setting: renders the static check
 * (no spring, no confetti) but still fires the haptic + onDone.
 */
const DOT_COLORS = [
  LightColors.primary,
  LightColors.success,
  LightColors.warning,
  LightColors.danger,
  LightColors.info,
  LightColors.primary400,
] as const;

const DOT_COUNT = 12;

function ConfettiDot({
  index,
  progress,
  size,
}: {
  index: number;
  progress: SharedValue<number>;
  size: number;
}) {
  // Deterministic per-dot geometry — evenly spread angles with a small
  // index-based jitter so the burst doesn't read as a perfect ring.
  const angle = (index / DOT_COUNT) * Math.PI * 2 + (index % 2) * 0.26;
  const distance = size * (0.85 + (index % 3) * 0.22);
  const dotSize = 5 + (index % 3) * 2;

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateX: Math.cos(angle) * distance * progress.value },
      {
        // Slight "gravity" pull so dots arc downward as they fade.
        translateY:
          Math.sin(angle) * distance * progress.value +
          0.3 * distance * progress.value * progress.value,
      },
      { scale: 1 - 0.45 * progress.value },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: DOT_COLORS[index % DOT_COLORS.length],
        },
        style,
      ]}
    />
  );
}

export function SuccessCheck({
  size = 96,
  color = LightColors.success,
  celebrate = false,
  haptic = true,
  onDone,
  testID,
}: SuccessCheckProps) {
  const reduceMotion = useReducedMotion();

  const circleScale = useSharedValue(0);
  const checkScale = useSharedValue(0);
  const confettiProgress = useSharedValue(0);

  // Refs so the mount effect never re-fires the haptic / onDone when a
  // parent re-renders with a new callback identity.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const hapticFired = useRef(false);
  const doneFired = useRef(false);

  useEffect(() => {
    if (haptic && !hapticFired.current) {
      hapticFired.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    }

    if (reduceMotion) {
      // Static check — snap everything to its settled state.
      circleScale.value = 1;
      checkScale.value = 1;
      confettiProgress.value = 1; // dots fully faded out
    } else {
      circleScale.value = withSpring(1, { damping: 14, stiffness: 220 });
      checkScale.value = withDelay(
        140,
        withSpring(1, { damping: 12, stiffness: 260 }),
      );
      if (celebrate) {
        confettiProgress.value = withDelay(
          220,
          withTiming(1, { duration: 650, easing: Easing.out(Easing.quad) }),
        );
      }
    }

    const t = setTimeout(
      () => {
        if (doneFired.current) return;
        doneFired.current = true;
        onDoneRef.current?.();
      },
      reduceMotion ? 50 : 900,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
  }));
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const checkSize = size * 0.52;

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="Success"
    >
      {celebrate && !reduceMotion && (
        <View pointerEvents="none" style={styles.confettiLayer}>
          {Array.from({ length: DOT_COUNT }, (_, i) => (
            <ConfettiDot
              key={i}
              index={i}
              progress={confettiProgress}
              size={size}
            />
          ))}
        </View>
      )}
      <Animated.View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
          circleStyle,
        ]}
      >
        <Animated.View style={checkStyle}>
          <Svg
            width={checkSize}
            height={checkSize}
            viewBox="0 0 24 24"
            fill="none"
          >
            <Path
              d="M20 6L9 17l-5-5"
              stroke={LightColors.textInverse}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // Confetti dots travel outside the circle's bounds.
    overflow: 'visible',
  },
  confettiLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
