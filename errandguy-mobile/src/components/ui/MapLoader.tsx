import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { MapPin } from 'lucide-react-native';

interface MapLoaderProps {
  /** Pin size */
  size?: number;
  /** Pin/accent color */
  color?: string;
  /** Optional text */
  message?: string;
}

export function MapLoader({ size = 36, color = '#2563EB', message }: MapLoaderProps) {
  const bounce = useSharedValue(0);

  useEffect(() => {
    bounce.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) }),
        withSpring(0, { damping: 8, stiffness: 200 }),
      ),
      -1,
      false,
    );
  }, [bounce]);

  const pinStyle = useAnimatedStyle(() => {
    const translateY = interpolate(bounce.value, [0, 1], [0, -20]);
    return {
      transform: [{ translateY }],
    };
  });

  const shadowStyle = useAnimatedStyle(() => {
    const scaleX = interpolate(bounce.value, [0, 1], [1, 0.5]);
    const opacity = interpolate(bounce.value, [0, 1], [0.3, 0.1]);
    return {
      transform: [{ scaleX }],
      opacity,
    };
  });

  return (
    <View style={ml.container}>
      <Animated.View style={[ml.pin, pinStyle]}>
        <MapPin size={size} color={color} fill={color} fillOpacity={0.2} />
      </Animated.View>
      <Animated.View
        style={[
          ml.shadow,
          { width: size * 0.8, height: size * 0.2, borderRadius: size * 0.1 },
          shadowStyle,
        ]}
      />
    </View>
  );
}

const ml = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
  },
  pin: {
    marginBottom: 4,
  },
  shadow: {
    backgroundColor: '#0F172A',
  },
});
