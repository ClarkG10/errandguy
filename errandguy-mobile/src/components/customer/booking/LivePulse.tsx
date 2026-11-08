import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LightColors } from '../../../constants/colors';
import { useReducedMotion } from '../../../hooks/useReducedMotion';

/**
 * A small "live" dot: something is actively happening (the runner search).
 * A ring breathes out of the dot; under Reduce Motion it is a still dot.
 */
export function LivePulse({ color = LightColors.primary, size = 10 }: { color?: string; size?: number }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(progress);
  }, [reduceMotion, progress]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0 : 0.35 * (1 - progress.value),
    transform: [{ scale: 1 + 1.6 * progress.value }],
  }));

  const box = size * 2.6;
  return (
    <View
      style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Animated.View
        style={[
          { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          ringStyle,
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
