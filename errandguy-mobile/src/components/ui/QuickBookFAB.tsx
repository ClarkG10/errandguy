import React, { useRef, useEffect } from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  Animated,
  Easing,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../../constants/responsive';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useTabBarStore } from '../../stores/tabBarStore';
import { Elevation, LightColors } from '../../constants/colors';

/**
 * Floating Quick-Book button.
 *
 * Anchored to the right edge above the tab bar so a customer can
 * start a new errand from any tab without first navigating Home.
 * Sized and offset using the responsive scale + safe area insets so
 * it never overlaps the tab bar on a notched phone, never floats
 * absurdly high on a tablet, and never sits inside the home-bar
 * gesture zone on iOS.
 *
 * Hidden on screens where it would obstruct critical UI: the booking
 * funnel itself (book/*), the live tracking screen, the chat thread.
 *
 * Pulses once on first appearance so users notice the affordance the
 * first time the customer tabs render — the animation is suppressed
 * for users with Reduced Motion enabled.
 */
export interface QuickBookFABProps {
  /** Height of the bottom tab bar (without safe area). Used to lift
   *  the FAB above it. */
  tabBarHeight: number;
  /** Override visibility check. Defaults to "show on customer tabs". */
  visible?: boolean;
  /** Override the destination. Defaults to the errand-type picker. */
  href?: string;
  testID?: string;
}

const HIDDEN_PATH_PREFIXES = [
  '/book/',          // booking funnel — full-screen forms / map
  '/tracking/',      // active errand — sticky bottom sheet
  '/chat/',          // chat thread — keyboard interaction
  '/navigate/',      // runner navigation
  '/errand/',        // runner active errand
  '/wallet/top-up',  // payment confirmation
];

export function QuickBookFAB({
  tabBarHeight,
  visible: visibleProp,
  href = '/(customer)/book/type',
  testID,
}: QuickBookFABProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { mScale, isTablet } = useResponsive();
  const reduceMotion = useReducedMotion();
  // Slide/fade away in lockstep with the tab bar when the user scrolls down.
  const hidden = useTabBarStore((s) => s.hidden);

  // Auto-hide on screens that already host primary actions in the
  // bottom area. Consumers can still force visibility via the prop.
  const autoVisible = !HIDDEN_PATH_PREFIXES.some((p) =>
    (pathname ?? '').includes(p),
  );
  const visible = visibleProp ?? autoVisible;

  // First-mount nudge — a small upward bob so users register the new
  // affordance. Runs once per app session per tab-screen mount, then
  // the FAB stays still.
  const bob = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const hide = useRef(new Animated.Value(0)).current; // 0 shown, 1 hidden
  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      // Visibility must never depend on the decorative bob — snap to
      // fully shown so reduced-motion users get the FAB, just still.
      bob.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.delay(400),
      Animated.timing(bob, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
    ]).start();
  }, [reduceMotion, visible, bob]);

  // Follow the tab bar's auto-hide. Snap (no tween) under Reduce Motion.
  useEffect(() => {
    if (reduceMotion) {
      hide.setValue(hidden ? 1 : 0);
      return;
    }
    Animated.timing(hide, {
      toValue: hidden ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hidden, reduceMotion, hide]);

  if (!visible) return null;

  // Size + offset are scaled subtly so the FAB feels right-sized on
  // both an iPhone SE and an iPad. Slightly tighter (52pt) than the
  // previous 56pt to align with the modernised, less-bulky CTA scale
  // — still well above the 44pt touch-target minimum.
  const SIZE = mScale(52);
  const ICON = mScale(22);
  // Straddle the tab bar's TOP edge: the FAB's centre sits on the bar's
  // top border so half the disc floats above the bar (over the content)
  // and half overlaps the bar's centre gap — the classic docked-FAB look
  // the user asked for ("floating on the top line", not a whole circle
  // buried inside the bar). Bar top edge = tabBarHeight + insets.bottom
  // from the screen bottom; subtract half the disc to centre on it.
  const bottom = insets.bottom + tabBarHeight - SIZE / 2;
  // Centre-positioned so the FAB sits above the tab bar's empty mid-gap
  // (between Activity and Alerts). Uses transform-based centring so it
  // works for any device width and respects the press-scale animation.
  void isTablet;

  // Press feedback is functional (not decorative), so it is not
  // gated behind reduced motion — iOS has no ripple fallback.
  const handlePressIn = () => {
    Animated.spring(press, {
      toValue: 0.92,
      speed: 50,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = () => {
    Animated.spring(press, {
      toValue: 1,
      speed: 30,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  };
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push(href as any);
  };

  // When the tab bar hides, drop the FAB fully below the screen edge and fade
  // it out. Composed with the first-appearance bob so the two never fight.
  const hideTranslateY = hide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, insets.bottom + tabBarHeight + SIZE],
  });
  const containerStyle: Animated.WithAnimatedObject<ViewStyle> = {
    position: 'absolute',
    left: '50%',
    bottom,
    transform: [
      // Centre horizontally — half the FAB diameter pulls the left
      // anchor back so the disc sits exactly on the screen centreline.
      { translateX: -SIZE / 2 },
      { scale: press },
      // Bob in from below by 10pt the first time we appear, plus the
      // scroll-driven hide drop.
      {
        translateY: Animated.add(
          bob.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
          hideTranslateY,
        ),
      },
    ],
    opacity: Animated.multiply(
      bob.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
      hide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    ),
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={containerStyle}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quick book a new errand"
        testID={testID ?? 'quick-book-fab'}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        android_ripple={{
          color: `${LightColors.textInverse}2E`,
          borderless: true,
          radius: SIZE / 2,
        }}
        style={[
          styles.fab,
          {
            width: SIZE,
            height: SIZE,
            borderRadius: SIZE / 2,
          },
        ]}
      >
        {/* Brand gradient fill — deepens the blue-first identity and
            gives the FAB a real sense of light source. */}
        <LinearGradient
          pointerEvents="none"
          colors={[
            LightColors.gradientEnd,
            LightColors.gradientMid,
            LightColors.gradientStart,
          ]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.innerHighlight} />
        <Plus size={ICON} color={LightColors.textInverse} strokeWidth={2.6} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fab: {
    backgroundColor: LightColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // Brand-tinted shadow — soft and diffuse so the FAB floats
    // rather than pops. Android keeps a stronger explicit lift.
    ...Elevation.primary,
    elevation: 9,
  },
  innerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: `${LightColors.textInverse}47`,
  },
});
