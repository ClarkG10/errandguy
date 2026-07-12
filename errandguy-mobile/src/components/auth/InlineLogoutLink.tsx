import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LightColors } from '../../constants/colors';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

const ARM_WINDOW_MS = 3000;

interface InlineLogoutLinkProps {
  onConfirm: () => void;
  /** Override the default copy if a screen wants a softer label. */
  label?: string;
  confirmLabel?: string;
}

/**
 * Inline tap-to-confirm logout.
 *
 * Replaces the modal/bottom-sheet logout confirmation with a quieter,
 * inline interaction:
 *
 *   1. The link reads "Log out". A first tap "arms" it — the label
 *      morphs to "Tap again to confirm" with a thin progress bar
 *      counting down ~3 seconds.
 *   2. If the user taps again within the window, logout fires.
 *   3. If they don't, the link silently disarms and reverts.
 *
 * Why:
 *   • Logout is destructive but easily reversible (re-sign-in is a
 *     single screen). A whole modal is overkill.
 *   • Two taps with a clearly armed state prevent accidental logout
 *     without disrupting the user's flow.
 *   • No new surface, no dim layer, no animation jank, no "did I
 *     just leave the app?" disorientation.
 *   • Mirrors the "Tap again to undo" / "Hold to confirm" patterns
 *     used by Twitter, Instagram, Linear, and most modern fintech.
 *
 * Haptics are subtle — Light on arm, Success on confirm. No success
 * haptic if the user lets it disarm.
 */
export function InlineLogoutLink({
  onConfirm,
  label = 'Log out',
  confirmLabel = 'Tap again to confirm',
}: InlineLogoutLinkProps) {
  const [armed, setArmed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progress = useSharedValue(0);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      cancelAnimation(progress);
    };
  }, [progress]);

  const disarm = () => {
    setArmed(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    cancelAnimation(progress);
    progress.value = withTiming(0, { duration: 180 });
  };

  const handlePress = () => {
    if (!armed) {
      setArmed(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      progress.value = 0;
      progress.value = withTiming(1, {
        duration: ARM_WINDOW_MS,
        easing: Easing.linear,
      });
      timeoutRef.current = setTimeout(() => {
        setArmed(false);
        progress.value = withTiming(0, { duration: 240 });
      }, ARM_WINDOW_MS);
      return;
    }

    // Confirmed — fire logout. Don't bother resetting visual state;
    // the screen is about to unmount.
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    cancelAnimation(progress);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onConfirm();
  };

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={handlePress}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={armed ? `${confirmLabel} to log out` : label}
        accessibilityHint={armed ? 'Tap again within 3 seconds' : undefined}
        style={({ pressed }) => [s.btn, pressed && { opacity: 0.7 }]}
      >
        <Text
          style={[s.label, armed && s.labelArmed]}
          numberOfLines={1}
        >
          {armed ? confirmLabel : label}
        </Text>
        {/* Track + Cancel keep their footprint when disarmed (hidden,
            not unmounted) so arming never shifts the layout around the
            link — a mid-tap reflow here risks a mis-hit on whatever
            sits below. */}
        <View
          style={[s.barTrack, !armed && s.hidden]}
          pointerEvents={armed ? 'auto' : 'none'}
          accessibilityElementsHidden={!armed}
          importantForAccessibility={armed ? 'auto' : 'no-hide-descendants'}
        >
          <Animated.View style={[s.barFill, barStyle]} />
        </View>
      </Pressable>
      <Pressable
        onPress={disarm}
        hitSlop={8}
        style={[s.cancelBtn, !armed && s.hidden]}
        pointerEvents={armed ? 'auto' : 'none'}
        accessibilityRole="button"
        accessibilityLabel="Cancel logout"
        accessibilityElementsHidden={!armed}
        importantForAccessibility={armed ? 'auto' : 'no-hide-descendants'}
        disabled={!armed}
      >
        <Text style={s.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  btn: {
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 180,
  },
  // Hidden-but-reserved state for the countdown track + Cancel — see
  // the render note about avoiding layout shift on arm.
  hidden: { opacity: 0 },
  label: {
    fontSize: 14,
    // Quicksand, not Montserrat — the Montserrat families are never
    // loaded by the app's useFonts call (they'd silently fall back).
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textTertiary,
    textDecorationLine: 'underline',
    textAlign: 'center',
    alignSelf: 'center',
  },
  labelArmed: {
    color: LightColors.dangerDark,
    textDecorationLine: 'none',
  },
  barTrack: {
    marginTop: 6,
    width: 132,
    height: 2,
    borderRadius: 1,
    backgroundColor: LightColors.dangerSoft,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: LightColors.dangerDark,
  },
  cancelBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  cancelText: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textMuted,
  },
});
