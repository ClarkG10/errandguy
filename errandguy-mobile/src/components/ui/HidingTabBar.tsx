import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  BottomTabBar,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { useTabBarStore } from '../../stores/tabBarStore';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * Bottom tab bar that slides out on scroll-down and back on scroll-up.
 *
 * Passed as the navigator's `tabBar`. It is positioned ABSOLUTELY at the
 * bottom, which takes it out of the navigator's flex flow so the scene fills
 * the full height behind it (React Navigation's screens are `flex: 1`) — so
 * hiding the bar reveals content underneath instead of a blank strip. Every
 * tab scroller reserves bottom padding (TAB_CONTENT_BOTTOM_INSET*) so its last
 * row still clears the bar when it's shown.
 *
 * Visibility comes from the shared tab-bar store, which `useHideTabBarOnScroll`
 * drives from each tab screen. Motion is suppressed under Reduce Motion.
 */
export function HidingTabBar(props: BottomTabBarProps) {
  const hidden = useTabBarStore((s) => s.hidden);
  const reduceMotion = useReducedMotion();

  // 0 = shown, 1 = fully slid away.
  const progress = useSharedValue(0);
  // Measured bar height (incl. the safe-area inset the bar reserves) so we
  // translate by exactly enough to clear the screen edge.
  const height = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion
      ? hidden
        ? 1
        : 0
      : withTiming(hidden ? 1 : 0, {
          duration: 220,
          easing: Easing.out(Easing.cubic),
        });
  }, [hidden, reduceMotion, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * (height.value || 120) }],
    // Mostly a slide; a light fade keeps it from lingering as a hard edge.
    opacity: 1 - progress.value * 0.25,
  }));

  return (
    <Animated.View
      style={[styles.container, style]}
      onLayout={(e) => {
        height.value = e.nativeEvent.layout.height;
      }}
    >
      <BottomTabBar {...props} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
