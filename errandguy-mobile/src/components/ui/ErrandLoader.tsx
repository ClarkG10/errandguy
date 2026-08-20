import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors } from '../../constants/colors';

interface ErrandLoaderProps {
  /** Dot diameter */
  size?: number;
  /** Dot colour */
  color?: string;
}

const DURATION = 400; // ms per half-cycle
const DOT_GAP = 6;

function Dot({
  size,
  color,
  delay,
  reduceMotion,
}: {
  size: number;
  color: string;
  delay: number;
  reduceMotion: boolean;
}) {
  const scale = useSharedValue(reduceMotion ? 1 : 0.4);

  useEffect(() => {
    if (reduceMotion) {
      // Reduce-Motion: freeze the pulse to a static row of dots (same
      // accessibility stance as <Skeleton> / <ProgressBar>).
      scale.value = 1;
      return;
    }
    scale.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DURATION, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: DURATION, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, scale, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 0.4 + scale.value * 0.6,
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function ErrandLoader({ size = 8, color = LightColors.textInverse }: ErrandLoaderProps) {
  const stagger = DURATION * 0.4;
  const reduceMotion = useReducedMotion();
  return (
    <View style={[styles.container, { gap: DOT_GAP }]}>
      <Dot size={size} color={color} delay={0} reduceMotion={reduceMotion} />
      <Dot size={size} color={color} delay={stagger} reduceMotion={reduceMotion} />
      <Dot size={size} color={color} delay={stagger * 2} reduceMotion={reduceMotion} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
