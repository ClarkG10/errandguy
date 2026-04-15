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

interface ErrandLoaderProps {
  /** Dot diameter */
  size?: number;
  /** Dot colour */
  color?: string;
}

const DURATION = 400; // ms per half-cycle
const DOT_GAP = 6;

function Dot({ size, color, delay }: { size: number; color: string; delay: number }) {
  const scale = useSharedValue(0.4);

  useEffect(() => {
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
  }, [delay, scale]);

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

export function ErrandLoader({ size = 8, color = '#fff' }: ErrandLoaderProps) {
  const stagger = DURATION * 0.4;
  return (
    <View style={[styles.container, { gap: DOT_GAP }]}>
      <Dot size={size} color={color} delay={0} />
      <Dot size={size} color={color} delay={stagger} />
      <Dot size={size} color={color} delay={stagger * 2} />
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
