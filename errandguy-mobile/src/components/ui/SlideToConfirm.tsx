import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { haptics } from '../../utils/haptics';
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
const THRESHOLD = 0.7;
/**
 * Minimum rightward finger travel, in points, before a gesture may
 * complete. The thumb now comes to the finger when the track is grabbed
 * away from the thumb, so without this a jab at the right-hand end of
 * the track would land the thumb past THRESHOLD and confirm on release.
 * These two transitions ("item handed over", "errand complete") are
 * money-affecting and hard to undo, so a deliberate push is required no
 * matter where the drag starts. A normal drag from rest travels
 * ~THRESHOLD × maxX (≈160pt), far past this floor.
 */
const MIN_DRAG_TRAVEL = 56;
/** How far the thumb bounces to answer a tap. */
const NUDGE_X = 16;
/** How long a "you didn't finish the slide" hint stays on the track. */
const HINT_MS = 1800;
const HINT_TAP = "Slide, don't tap";
const HINT_SHORT = 'Slide all the way';
const SPRING = { damping: 20, stiffness: 240, mass: 0.8 } as const;

/**
 * Slide-to-confirm control for consequential, hard-to-undo actions
 * (start errand, confirm cash received, emergency SOS arm). A drag is
 * deliberately harder to trigger accidentally than a tap.
 *
 * Grab anywhere: the pan covers the WHOLE track, not just the thumb.
 * Grabbing the thumb picks it up where it is; grabbing the bare track
 * brings the thumb to the finger. A drag that stops short springs back
 * with a hint instead of failing silently, and a plain tap — the first
 * thing anyone tries — answers with a nudge + hint rather than nothing.
 *
 * Accessibility: the whole control is exposed as a single button.
 * Screen-reader users double-tap (onAccessibilityTap) or use the custom
 * "activate" action to complete — they are never required to perform
 * the drag gesture. The tap/nudge affordance is deliberately hidden
 * from the a11y tree (`accessible={false}`) so a TalkBack double-tap
 * still reaches the outer button and confirms, rather than nudging.
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
  const [hint, setHint] = useState<string | null>(null);

  const tx = useSharedValue(0);
  const startX = useSharedValue(0);
  const completedRef = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxX = Math.max(0, trackWidth - THUMB_SIZE - PAD * 2);
  const isLocked = disabled || loading;

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const showHint = useCallback((message: string) => {
    setHint(message);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  }, []);

  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(null);
    haptics.success();
    onComplete();
  }, [onComplete]);

  /** A drag that didn't reach the end — spring-back is already running,
   *  this is the part that tells the user why nothing happened. */
  const handleFellShort = useCallback(
    (moved: boolean) => {
      if (completedRef.current) return;
      haptics.light();
      showHint(moved ? HINT_SHORT : HINT_TAP);
    },
    [showHint],
  );

  /** A tap on the track: teach the gesture instead of doing nothing. */
  const handleTrackTap = useCallback(() => {
    if (isLocked || completedRef.current) return;
    haptics.light();
    showHint(HINT_TAP);
    if (!reduceMotion && maxX > 0) {
      tx.value = withSequence(
        withTiming(Math.min(NUDGE_X, maxX), { duration: 110 }),
        withSpring(0, SPRING),
      );
    }
  }, [isLocked, maxX, reduceMotion, showHint, tx]);

  // Screen-reader activation path — no drag required.
  const activate = useCallback(() => {
    if (isLocked || completedRef.current) return;
    if (maxX > 0) {
      tx.value = reduceMotion ? maxX : withSpring(maxX, SPRING);
    }
    handleComplete();
  }, [isLocked, maxX, reduceMotion, tx, handleComplete]);

  const pan = Gesture.Pan()
    // Horizontal intent only. The pan now covers the whole track, and both
    // call sites sit inside something that wants vertical drags: the runner
    // cockpit's sticky footer under a ScrollView, and the customer tracking
    // sheet where the SOS stand-down slider renders inside ExpandableSheet's
    // own handle pan. Without these, a vertical drag that happens to start
    // on the 56pt track would be swallowed instead of scrolling/resizing.
    .activeOffsetX([-12, 12])
    .failOffsetY([-30, 30])
    .onStart((e) => {
      if (isLocked || maxX <= 0) {
        startX.value = tx.value;
        return;
      }
      // Grab-anywhere means "no dead touches", never "teleport the
      // progress": wherever the finger lands, it picks the thumb up FROM
      // WHERE IT IS and the drag moves it from there. Adopting the touch
      // POSITION instead let a single ~56pt swipe near the right end of the
      // track commit the action — and one consumer of this control is the
      // SOS stand-down, where the whole point of a slider is that cancelling
      // an emergency alert cannot happen by accident. The full-track drag is
      // the deliberateness; keep it.
      const adopted = tx.value;
      // `translationX` is measured from touch-down, but activeOffsetX means
      // the gesture only starts after ~12pt of travel. Rebase so onUpdate's
      // `startX + translationX` resumes exactly where the thumb is now
      // instead of jumping that slop forward on the first frame.
      startX.value = adopted - e.translationX;
      tx.value = adopted;
    })
    .onUpdate((e) => {
      if (isLocked || maxX <= 0) return;
      const next = startX.value + e.translationX;
      tx.value = Math.min(maxX, Math.max(0, next));
    })
    .onEnd((e) => {
      if (isLocked || maxX <= 0) return;
      if (tx.value >= maxX * THRESHOLD && e.translationX >= MIN_DRAG_TRAVEL) {
        tx.value = withSpring(maxX, SPRING);
        runOnJS(handleComplete)();
      } else {
        const moved = tx.value > maxX * 0.15;
        tx.value = withSpring(0, SPRING);
        runOnJS(handleFellShort)(moved);
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
      <Animated.Text
        style={[styles.label, hint ? styles.labelHint : null, labelStyle]}
        numberOfLines={1}
      >
        {hint ?? label}
      </Animated.Text>
      {/* The pan covers the whole track — the thumb used to be the only
          grabbable 48pt, which read as an inert control to anyone who
          pushed the track itself. */}
      <GestureDetector gesture={pan}>
        <Animated.View style={StyleSheet.absoluteFill}>
          {/* Tap surface, under the thumb and hidden from the a11y tree.
              A tap can't confirm (that would defeat the whole control) —
              it nudges and hints so the gesture is discoverable. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleTrackTap}
            disabled={isLocked}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            testID={testID ? `${testID}-track` : undefined}
          />
          <Animated.View
            pointerEvents="none"
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
  labelHint: {
    color: LightColors.textTertiary,
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
