import React, { useRef, useEffect } from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  Platform,
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
import { LightColors } from '../../constants/colors';

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
  useEffect(() => {
    if (reduceMotion || !visible) return;
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

  if (!visible) return null;

  // Size + offset are scaled subtly so the FAB feels right-sized on
  // both an iPhone SE and an iPad. Slightly tighter (52pt) than the
  // previous 56pt to align with the modernised, less-bulky CTA scale
  // — still well above the 44pt touch-target minimum.
  const SIZE = mScale(52);
  const ICON = mScale(22);
  // Dock into the tab bar's top edge so the disc feels integrated
  // with the navigation shell instead of floating above content.
  const bottom = insets.bottom + tabBarHeight - SIZE / 2 - mScale(6);
  // Centre-positioned so the FAB sits visually above the tab bar's
  // empty mid-gap (between Activity and Alerts). Uses transform-based
  // centring so it works for any device width and respects the
  // press-scale animation.
  void isTablet;

  const handlePressIn = () => {
    if (reduceMotion) return;
    Animated.spring(press, {
      toValue: 0.92,
      speed: 50,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = () => {
    if (reduceMotion) return;
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

  const containerStyle: Animated.WithAnimatedObject<ViewStyle> = {
    position: 'absolute',
    left: '50%',
    bottom,
    transform: [
      // Centre horizontally — half the FAB diameter pulls the left
      // anchor back so the disc sits exactly on the screen centreline.
      { translateX: -SIZE / 2 },
      { scale: press },
      // Bob in from below by 10pt the first time we appear.
      {
        translateY: bob.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
        }),
      },
    ],
    opacity: bob.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
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
          color: 'rgba(255,255,255,0.18)',
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
        <Plus size={ICON} color="#FFFFFF" strokeWidth={2.6} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fab: {
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // Brand-tinted shadow so the FAB lifts off the page without
    // looking heavy. Matches the elevation language used by Button.
    ...Platform.select({
      ios: {
        shadowColor: '#1D4ED8',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.36,
        shadowRadius: 16,
      },
      android: { elevation: 9 },
      default: {},
    }),
  },
  innerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
});
