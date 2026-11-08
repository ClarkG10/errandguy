import React, { useCallback } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../../hooks/useReducedMotion';

interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  /** The touch target's own layout (width, margins). A plain style, never a
   *  function: a NativeWind Pressable with a style callback drops layout. */
  style?: StyleProp<ViewStyle>;
  /** The card that reacts to the press: background, border, radius, padding,
   *  shadow and inner layout all go here (it is an Animated.View, so no
   *  className). */
  contentStyle?: StyleProp<ViewStyle>;
  /** How far the card settles while held. Subtle by default. */
  pressedScale?: number;
  children: React.ReactNode;
}

/**
 * A card that answers a touch: it settles to 98% and dims slightly while held,
 * then springs back (150–180ms). Under Reduce Motion it only dims — no scale.
 */
export function PressableScale({
  style,
  contentStyle,
  pressedScale = 0.98,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      opacity.value = withTiming(0.92, { duration: 120 });
      if (!reduceMotion) {
        scale.value = withTiming(pressedScale, { duration: 150, easing: Easing.out(Easing.quad) });
      }
      onPressIn?.(e);
    },
    [onPressIn, opacity, pressedScale, reduceMotion, scale],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      opacity.value = withTiming(1, { duration: 180 });
      scale.value = reduceMotion
        ? 1
        : withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
      onPressOut?.(e);
    },
    [onPressOut, opacity, reduceMotion, scale],
  );

  return (
    <Pressable style={style} onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
      <Animated.View style={[contentStyle, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
