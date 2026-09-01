import React, { useContext, useEffect } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Modal,
  Platform,
  useWindowDimensions,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useKeyboard } from '../../hooks/useKeyboard';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';

// Smooth, non-bouncy slide-up. Critically damped so the sheet glides
// into place without any overshoot/oscillation.
const TIMING_IN = { duration: 260, easing: Easing.out(Easing.cubic) } as const;
// Closing — quick & deterministic, no overshoot.
const TIMING_OUT = { duration: 220, easing: Easing.in(Easing.cubic) } as const;
// Snappy follow-along when the keyboard slides in/out — must match the
// OS keyboard transition cadence so the sheet doesn't lag behind.
const TIMING_KB = { duration: 220, easing: Easing.out(Easing.cubic) } as const;

// Dismiss thresholds for the handle drag. The distance rule is the old
// one; the flick rule is new and exists because the drag surface is now
// the handle strip alone — a short, fast flick down must still close.
const DISMISS_DISTANCE = 100;
const DISMISS_FLICK_VELOCITY = 900;
const DISMISS_FLICK_DISTANCE = 24;

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
   * Pinned action row rendered OUTSIDE the scroll area, flush to the
   * bottom of the sheet, with safe-area padding. Use it for the sheet's
   * primary CTA so it stays at thumb height instead of sitting below the
   * fold of long content (mirrors `ExpandableSheet`'s `footer`).
   */
  footer?: React.ReactNode;
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
 * Drag-to-dismiss — the pan lives on the HANDLE STRIP only, matching
 * `ExpandableSheet`. It used to wrap the whole sheet, which meant the
 * pan claimed every vertical drag inside the body: the native scroller
 * (this component's own ScrollView, or a consumer's own ScrollView /
 * FlatList when `scrollable={false}`) was cancelled, and because
 * `onUpdate` clamps upward movement to the resting top an upward drag
 * produced literally zero movement — long sheets read as frozen and
 * anything below the fold (e.g. the runner's "Accept errand") was
 * unreachable. Scoping the pan is the cheap, uniform fix: no consumer
 * has to opt in, and it works identically for sheets that bring their
 * own scroller. Cost: swipe-anywhere-to-dismiss is gone; the backdrop
 * tap, `onAccessibilityEscape`, each sheet's own Close control and a
 * short flick on the handle remain as the escapes.
 */
export function BottomSheet({
  isVisible,
  onClose,
  snapPoints = [0.5],
  children,
  scrollable = true,
  footer,
  avoidKeyboard = true,
}: BottomSheetProps) {
  // Live height (not a module-scope snapshot) so snap math and the
  // off-screen resting position survive rotation / split-view resizes.
  const { height: SCREEN_HEIGHT } = useWindowDimensions();
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const context = useSharedValue(0);
  const { isVisible: kbVisible, height: kbHeight } = useKeyboard();
  // Read the insets off the context directly rather than through
  // `useSafeAreaInsets()`: that hook throws when no SafeAreaProvider is
  // mounted, and this component is rendered by unit tests (and inside a
  // Modal). `null` simply means "no provider" — fall back to the 12pt
  // floor, which is what `Math.max(insets.bottom, 12)` yields anyway on
  // every device without a home indicator.
  const insets = useContext(SafeAreaInsetsContext);
  const footerPadBottom = Math.max(insets?.bottom ?? 0, 12);

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
    // The visible handle strip is only ~26pt tall — under the 44dp floor for
    // the one surface that can drag-dismiss the sheet. Gesture-level slop
    // grows the grab area without moving layout: upward into the sheet's top
    // padding, downward a little over the content edge (a vertical drag that
    // close to the handle reads as a dismiss attempt anyway).
    .hitSlop({ top: 10, bottom: 10 })
    .onStart(() => {
      context.value = translateY.value;
    })
    .onUpdate((event) => {
      // Downward only. There is a single snap point, so there is nothing
      // above the resting top to drag towards — the clamp keeps an
      // upward drag from lifting the sheet off the bottom of the screen
      // and exposing the backdrop underneath it.
      translateY.value = Math.max(
        event.translationY + context.value,
        restingTop,
      );
    })
    .onEnd((event) => {
      const flicked =
        event.velocityY > DISMISS_FLICK_VELOCITY &&
        event.translationY > DISMISS_FLICK_DISTANCE;
      if (event.translationY > DISMISS_DISTANCE || flicked) {
        translateY.value = withTiming(SCREEN_HEIGHT, TIMING_OUT);
        runOnJS(onClose)();
      } else {
        translateY.value = withTiming(restingTop, TIMING_IN);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Render inside a real RN Modal so the sheet always overlays the WHOLE
  // screen. Previously this was a bare `absoluteFill` View, so a sheet
  // mounted inside a ScrollView (e.g. the review-step payment selector)
  // was positioned relative to that scroll content and rendered off-screen
  // / behind other UI — the tap registered but nothing usable appeared.
  // A Modal also puts the sheet above any sibling ExpandableSheet, fixing
  // the pickup-step "two stacked sheets" overlap.
  //
  // gesture-handler renders Modal content in a separate native hierarchy,
  // so it needs its own GestureHandlerRootView for drag-to-dismiss to work.
  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Pressable
          className="flex-1 bg-black/40"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <Animated.View
          className="absolute left-0 right-0 bg-surface"
          // Trap screen-reader focus inside the sheet and let the
          // standard escape gesture (iOS two-finger Z) dismiss it.
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            { height: sheetHeight },
            // Edge-to-edge sheet (no floating side margins) — modern
            // apps anchor sheets to the screen edges. Subtler top
            // corners + a diffuse top shadow give depth.
            {
              borderTopLeftRadius: Radius.sheet,
              borderTopRightRadius: Radius.sheet,
              shadowColor: LightColors.textPrimary,
              shadowOffset: { width: 0, height: -10 },
              shadowOpacity: 0.08,
              shadowRadius: 24,
              elevation: 12,
            },
            animatedStyle,
          ]}
        >
          {/* Drag handle area — ONLY this strip receives the pan gesture
              so inner ScrollViews/FlatLists continue to scroll normally
              (same rule as ExpandableSheet). The padding is a little
              taller than the bar needs so the grab target is ~26pt
              rather than the bare 4pt bar. */}
          <GestureDetector gesture={gesture}>
            <View className="items-center pt-3 pb-2.5" testID="sheet-drag-handle">
              <View className="w-10 h-1 rounded-full bg-divider" />
            </View>
          </GestureDetector>
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
                className={footer ? 'flex-1 px-4' : 'flex-1 px-4 pb-6'}
                showsVerticalScrollIndicator={false}
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: footer ? 12 : 24 }}
              >
                {children}
              </ScrollView>
            ) : (
              <View className={footer ? 'flex-1 px-4' : 'flex-1 px-4 pb-6'}>
                {children}
              </View>
            )}
            {/* Pinned CTA row. Outside the scroller, inside the KAV, so
                it rides above the keyboard and never scrolls away. */}
            {footer ? (
              <View
                className="px-4 pt-3 border-t border-divider bg-surface"
                style={{ paddingBottom: footerPadBottom }}
              >
                {footer}
              </View>
            ) : null}
          </KeyboardAvoidingView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
