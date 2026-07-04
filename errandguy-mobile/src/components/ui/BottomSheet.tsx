import React, { useEffect } from 'react';
import {
  View,
  Pressable,
  Dimensions,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useKeyboard } from '../../hooks/useKeyboard';
import { LightColors } from '../../constants/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
// Smooth, non-bouncy slide-up. Critically damped so the sheet glides
// into place without any overshoot/oscillation.
const TIMING_IN = { duration: 260, easing: Easing.out(Easing.cubic) } as const;
// Closing — quick & deterministic, no overshoot.
const TIMING_OUT = { duration: 220, easing: Easing.in(Easing.cubic) } as const;
// Snappy follow-along when the keyboard slides in/out — must match the
// OS keyboard transition cadence so the sheet doesn't lag behind.
const TIMING_KB = { duration: 220, easing: Easing.out(Easing.cubic) } as const;

interface BottomSheetProps {
  isVisible: boolean;
  onClose: () => void;
  /**
   * Snap point fractions of the screen height the sheet can rest at.
   * Defaults to `[0.5]` (a single half-screen snap). The sheet always
   * opens at the largest snap point.
   */
  snapPoints?: number[];
  children: React.ReactNode;
  scrollable?: boolean;
  /**
   * When the keyboard opens, automatically grow the sheet up to
   * (1 - this fraction) * screen height so the inputs inside stay
   * visible. Set to `false` to disable. Defaults to `true`.
   */
  avoidKeyboard?: boolean;
}

/**
 * Reanimated bottom sheet.
 *
 * Keyboard handling — when an input inside the sheet receives focus,
 * the sheet now lifts itself above the keyboard instead of letting
 * the OS push the entire window. This is critical for sheets with
 * inputs (filters, comment forms, address pickers, edit forms) where
 * the previous behaviour would obscure the field and submit button.
 *
 *   • The sheet's `translateY` follows the keyboard up.
 *   • If the chosen snap point isn't tall enough to clear the
 *     keyboard, we temporarily grow the sheet to fill the visible
 *     area above the keyboard.
 *   • A `KeyboardAvoidingView` wraps the inner content as a
 *     belt-and-braces measure on iOS where the keyboard animation
 *     occasionally beats our `translateY` by a frame.
 *
 * Drag-to-dismiss is preserved — the user can still pan the sheet
 * down past the velocity threshold to close it.
 */
export function BottomSheet({
  isVisible,
  onClose,
  snapPoints = [0.5],
  children,
  scrollable = true,
  avoidKeyboard = true,
}: BottomSheetProps) {
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const context = useSharedValue(0);
  const { isVisible: kbVisible, height: kbHeight } = useKeyboard();

  const baseSnap = Math.max(...snapPoints) * SCREEN_HEIGHT;
  // When the keyboard is up, expand the sheet up to (screen - keyboard
  // - safe top inset). The 56pt floor leaves a strip of dim above the
  // sheet so the user can still tap the dim to dismiss.
  const effectiveSnap =
    avoidKeyboard && kbVisible
      ? Math.max(baseSnap, SCREEN_HEIGHT - kbHeight - 56)
      : baseSnap;
  const sheetHeight = effectiveSnap;
  const restingTop = SCREEN_HEIGHT - sheetHeight;

  useEffect(() => {
    if (isVisible) {
      // When the keyboard transitions, use the snappier timing so the
      // sheet stays glued to the top of the keyboard.
      translateY.value = withTiming(
        restingTop,
        kbVisible ? TIMING_KB : TIMING_IN,
      );
    } else {
      translateY.value = withTiming(SCREEN_HEIGHT, TIMING_OUT);
    }
  }, [isVisible, restingTop, kbVisible, translateY]);

  const gesture = Gesture.Pan()
    .onStart(() => {
      context.value = translateY.value;
    })
    .onUpdate((event) => {
      translateY.value = Math.max(
        event.translationY + context.value,
        restingTop,
      );
    })
    .onEnd((event) => {
      if (event.translationY > 100) {
        translateY.value = withTiming(SCREEN_HEIGHT, TIMING_OUT);
        runOnJS(onClose)();
      } else {
        translateY.value = withTiming(restingTop, TIMING_IN);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!isVisible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={onClose}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View
          className="absolute left-0 right-0 bg-surface"
          style={[
            { height: sheetHeight },
            // Edge-to-edge sheet (no floating side margins) — modern
            // apps anchor sheets to the screen edges. Big soft top
            // corners + a diffuse top shadow give depth.
            {
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              shadowColor: LightColors.textPrimary,
              shadowOffset: { width: 0, height: -10 },
              shadowOpacity: 0.08,
              shadowRadius: 24,
              elevation: 12,
            },
            animatedStyle,
          ]}
        >
          <View className="items-center pt-2.5 pb-1.5">
            <View className="w-9 h-1 rounded-full bg-divider" />
          </View>
          {/*
            Inner KeyboardAvoidingView is a safety net on iOS for the
            rare frame where the keyboard animation beats our
            translateY. Behaviour is `padding` so the inner ScrollView
            shrinks instead of being pushed off the bottom of the
            sheet. Android relies on `windowSoftInputMode=adjustResize`
            (set by Expo by default) plus our translateY follow.
          */}
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}
          >
            {scrollable ? (
              <ScrollView
                className="flex-1 px-4 pb-6"
                showsVerticalScrollIndicator={false}
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                {children}
              </ScrollView>
            ) : (
              <View className="flex-1 px-4 pb-6">{children}</View>
            )}
          </KeyboardAvoidingView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
