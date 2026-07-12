import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ChevronsRight } from 'lucide-react-native';
import { Spinner } from './Spinner';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors } from '../../constants/colors';

interface SlideToConfirmProps {
  /** Track label, e.g. "Slide to confirm pickup". Also used as the
   *  accessibility label. */
  label: string;
  /** Fired once when the thumb crosses the completion threshold (or the
   *  control is activated via a screen reader). */
  onComplete: () => void;
  disabled?: boolean;
  /** Shows a spinner in the thumb and locks the gesture. Set this from
   *  the parent while the confirmed action is in flight. */
  loading?: boolean;
  /** Thumb / tint colour. Defaults to the brand primary. */
  color?: string;
  style?: ViewStyle;
  testID?: string;
}

const TRACK_HEIGHT = 56;
const THUMB_SIZE = 48;
const PAD = 4;
/** Fraction of the track the thumb must cross to complete. */
const THRESHOLD = 0.85;
const SPRING = { damping: 20, stiffness: 240, mass: 0.8 } as const;

/**
 * Slide-to-confirm control for consequential, hard-to-undo actions
 * (start errand, confirm cash received, emergency SOS arm). A drag is
 * deliberately harder to trigger accidentally than a tap.
 *
 * Accessibility: the whole control is exposed as a single button.
 * Screen-reader users double-tap (onAccessibilityTap) or use the custom
 * "activate" action to complete — they are never required to perform
 * the drag gesture.
 */
export function SlideToConfirm({
  label,
  onComplete,
  disabled = false,
  loading = false,
  color = LightColors.primary,
  style,
  testID,
}: SlideToConfirmProps) {
  const reduceMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);

  const tx = useSharedValue(0);
  const startX = useSharedValue(0);
  const completedRef = useRef(false);

  const maxX = Math.max(0, trackWidth - THUMB_SIZE - PAD * 2);
  const isLocked = disabled || loading;

  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    onComplete();
  }, [onComplete]);

  // Screen-reader activation path — no drag required.
  const activate = useCallback(() => {
    if (isLocked || completedRef.current) return;
    if (maxX > 0) {
      tx.value = reduceMotion ? maxX : withSpring(maxX, SPRING);
    }
    handleComplete();
  }, [isLocked, maxX, reduceMotion, tx, handleComplete]);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = tx.value;
    })
    .onUpdate((e) => {
      if (isLocked || maxX <= 0) return;
      const next = startX.value + e.translationX;
      tx.value = Math.min(maxX, Math.max(0, next));
    })
    .onEnd(() => {
      if (isLocked || maxX <= 0) return;
      if (tx.value >= maxX * THRESHOLD) {
        tx.value = withSpring(maxX, SPRING);
        runOnJS(handleComplete)();
      } else {
        tx.value = withSpring(0, SPRING);
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  // Progress tint fills behind the thumb as it advances.
  const fillStyle = useAnimatedStyle(() => ({
    width: tx.value + THUMB_SIZE + PAD * 2,
  }));

  // Label fades out as the thumb slides over it.
  const labelStyle = useAnimatedStyle(() => ({
    opacity:
      maxX > 0
        ? interpolate(tx.value, [0, maxX * 0.6], [1, 0], Extrapolation.CLAMP)
        : 1,
  }));

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Double tap to confirm, or slide the handle to the right"
      accessibilityState={{ disabled: isLocked, busy: loading }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate') activate();
      }}
      onAccessibilityTap={activate}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[
        styles.track,
        {
          backgroundColor: `${color}14`,
          borderColor: `${color}26`,
        },
        isLocked && styles.locked,
        style,
      ]}
      testID={testID}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { backgroundColor: `${color}1F` }, fillStyle]}
      />
      <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
        {label}
      </Animated.Text>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.thumb, { backgroundColor: color }, thumbStyle]}
        >
          {loading ? (
            <Spinner kind="brand" size={5} color={LightColors.textInverse} />
          ) : (
            <ChevronsRight
              size={22}
              color={LightColors.textInverse}
              strokeWidth={2.4}
            />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  locked: {
    opacity: 0.55,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_HEIGHT / 2,
  },
  label: {
    textAlign: 'center',
    fontSize: 15,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textSecondary,
    letterSpacing: 0.1,
    paddingHorizontal: THUMB_SIZE + PAD * 2,
  },
  thumb: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
