import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Button } from './Button';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';

/** How long a load runs before it counts as slow. */
export const SLOW_LOADING_MS = 4000;

/**
 * True once `active` has stayed true for `delayMs` without a break.
 *
 * Feed it whatever "still waiting" flag a screen already has (a useQuery's
 * `loading`, a submit's `loading`). It flips back to false the moment the
 * wait ends, and starts counting again from zero on the next one.
 */
export function useSlowLoading(active: boolean, delayMs: number = SLOW_LOADING_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return active && slow;
}

interface SlowNetworkNoticeProps {
  /** The wait to watch. The notice appears after `delayMs` of it. */
  loading?: boolean;
  /** Show it now, for a screen that tracks slowness itself. Wins over `loading`. */
  visible?: boolean;
  delayMs?: number;
  /** Start the request again. Leave out when retrying would only queue a duplicate. */
  onRetry?: () => void;
  retryLabel?: string;
  /** The label over the bar. Defaults to "Still loading · slow connection". */
  label?: string;
  /** Kept for compatibility — an extra line under the bar. */
  message?: string;
  /** Real progress, 0–1, when the screen knows it ("2 of 6 photos"). Without
   *  it the bar is an honest "still going" sweep, not a fake percentage. */
  progress?: number;
  /** A lighter path that really works without the slow part, shown as a
   *  full-width outline button — e.g. "Type the address instead". Only pass
   *  one the screen can actually take. */
  lighterPathLabel?: string;
  onLighterPath?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const BAR_HEIGHT = 4;
const SWEEP_FRACTION = 0.35;

/**
 * Pattern 5 (slow network): a thin progress bar with an honest label —
 * "Still loading · slow connection" — shown under a skeleton or spinner once
 * a load has run ~4s, with a retry when one is safe and, where it can really
 * work, a lighter path.
 *
 * It says the app is still working (so nobody force-quits a request that
 * would have landed) and names the likely cause, without blaming the person
 * or claiming to know more than that.
 */
export function SlowNetworkNotice({
  loading = false,
  visible,
  delayMs = SLOW_LOADING_MS,
  onRetry,
  retryLabel = 'Try again',
  label = 'Still loading · slow connection',
  message,
  progress,
  lighterPathLabel,
  onLighterPath,
  style,
  testID = 'slow-network-notice',
}: SlowNetworkNoticeProps) {
  const slow = useSlowLoading(loading, delayMs);
  const shown = visible ?? slow;
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  const sweep = useSharedValue(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const determinate = typeof progress === 'number' && Number.isFinite(progress);
  const pct = determinate ? Math.max(0, Math.min(1, progress as number)) : 0;

  useEffect(() => {
    if (!shown) return;
    opacity.value = reduceMotion ? 1 : withTiming(1, { duration: 200 });
  }, [shown, reduceMotion, opacity]);

  useEffect(() => {
    if (!shown || determinate || reduceMotion) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }
    sweep.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }), -1, false);
    return () => cancelAnimation(sweep);
  }, [shown, determinate, reduceMotion, sweep]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -trackWidth * SWEEP_FRACTION + sweep.value * trackWidth * (1 + SWEEP_FRACTION) }],
  }));

  if (!shown) return null;

  const onTrackLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <Animated.View
      style={[s.wrap, fade, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={determinate ? { min: 0, max: 100, now: Math.round(pct * 100) } : undefined}
      accessibilityLiveRegion="polite"
    >
      <View style={s.head}>
        <Text style={s.label}>{label}</Text>
        {determinate ? (
          <Text style={s.pct}>{Math.round(pct * 100)}%</Text>
        ) : onRetry ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
            hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
            // Static style + className press state: a function `style` on a
            // Pressable drops its layout under NativeWind.
            className="active:opacity-60"
            style={s.retry}
          >
            <Text style={s.retryText}>{retryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={s.track} onLayout={onTrackLayout}>
        {determinate ? (
          <View style={[s.fill, { width: `${pct * 100}%` }]} />
        ) : reduceMotion ? (
          // Still: a short static segment — no endless motion under Reduce Motion.
          <View style={[s.fill, { width: `${SWEEP_FRACTION * 100}%` }]} />
        ) : (
          <Animated.View style={[s.fill, { width: `${SWEEP_FRACTION * 100}%` }, sweepStyle]} />
        )}
      </View>
      {message ? <Text style={s.message}>{message}</Text> : null}
      {lighterPathLabel && onLighterPath ? (
        <View style={s.lighter}>
          <Button title={lighterPathLabel} variant="outline" size="lg" fullWidth onPress={onLighterPath} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // Its own quiet surface, so it reads cleanly over a skeleton or a list.
  wrap: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.card,
    backgroundColor: LightColors.surface,
    borderWidth: 1,
    borderColor: LightColors.divider,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 20,
  },
  label: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textSecondary,
  },
  pct: {
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  retry: { marginLeft: 12 },
  retryText: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.primary,
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: LightColors.divider,
    overflow: 'hidden',
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: LightColors.primary,
  },
  message: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
  },
  lighter: { marginTop: 12 },
});
