import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors } from '../../constants/colors';

/**
 * Determinate / indeterminate progress bar — the shared foundation for
 * UploadProgress, DownloadProgress and any "we know how far along we are"
 * moment (uploads, real downloads, multi-step waits).
 *
 * Palette matches ApiActivityBar (brand-blue fill on a `${primary}1F` track)
 * so every progress surface reads as one family. Determinate mode animates
 * the fill width in *pixels* (measured via onLayout) rather than a percentage
 * string — Reanimated animates numeric layout values reliably on both
 * platforms, whereas animated percentage widths are flaky on some versions.
 *
 * Reduce-Motion aware: the determinate fill snaps instead of easing, and the
 * indeterminate sweep freezes to a static 40% bar (same accessibility stance
 * as <Skeleton>).
 */
interface ProgressBarProps {
  /** 0–1 determinate fill. Values are clamped. Ignored when `indeterminate`. */
  progress?: number;
  /** Show the sweeping animation instead of a fixed fill (unknown duration). */
  indeterminate?: boolean;
  /** Optional caption rendered above the track. */
  label?: string;
  /** Track height in px (default 6). Corner radius tracks half the height. */
  height?: number;
  /** Append a trailing "NN%" beside the label. Determinate only. */
  showPercent?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({
  progress,
  indeterminate = false,
  label,
  height = 6,
  showPercent = false,
  style,
}: ProgressBarProps) {
  const reduceMotion = useReducedMotion();
  const pct = Math.max(0, Math.min(1, progress ?? 0));

  // ── Determinate fill (px width, measured from the track) ──────────────
  const [trackW, setTrackW] = useState(0);
  const fillW = useSharedValue(0);
  useEffect(() => {
    const target = pct * trackW;
    if (reduceMotion || trackW === 0) {
      fillW.value = target;
      return;
    }
    fillW.value = withTiming(target, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [pct, trackW, reduceMotion, fillW]);
  const fillStyle = useAnimatedStyle(() => ({ width: fillW.value }));

  // ── Indeterminate sweep (percentage translateX, like ApiActivityBar) ──
  const tx = useSharedValue(-1);
  useEffect(() => {
    if (!indeterminate || reduceMotion) {
      cancelAnimation(tx);
      return;
    }
    tx.value = -1;
    tx.value = withRepeat(
      withSequence(
        withTiming(1.4, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
        withTiming(-1, { duration: 0 }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(tx);
  }, [indeterminate, reduceMotion, tx]);
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${tx.value * 100}%` as any }],
  }));

  const radius = height / 2;
  const showHeader = !!label || (showPercent && !indeterminate);

  return (
    <View
      style={style}
      accessibilityRole="progressbar"
      accessibilityValue={
        indeterminate ? undefined : { min: 0, max: 100, now: Math.round(pct * 100) }
      }
      accessibilityLabel={label}
    >
      {showHeader && (
        <View style={styles.header}>
          {label ? (
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          ) : (
            <View />
          )}
          {showPercent && !indeterminate ? (
            <Text style={styles.percent}>{Math.round(pct * 100)}%</Text>
          ) : null}
        </View>
      )}

      <View
        style={[styles.track, { height, borderRadius: radius }]}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        {indeterminate ? (
          reduceMotion ? (
            <View style={[styles.staticSweep, { borderRadius: radius }]} />
          ) : (
            <Animated.View style={[styles.sweep, { borderRadius: radius }, sweepStyle]} />
          )
        ) : (
          <Animated.View style={[styles.fill, { borderRadius: radius }, fillStyle]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    flex: 1,
    fontSize: 12,
    color: LightColors.textSecondary,
    fontFamily: 'Quicksand_500Medium',
  },
  percent: {
    fontSize: 12,
    color: LightColors.textTertiary,
    fontFamily: 'Quicksand_500Medium',
    marginLeft: 8,
  },
  track: {
    width: '100%',
    backgroundColor: `${LightColors.primary}1F`,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: LightColors.primary,
  },
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '40%',
    backgroundColor: LightColors.primary,
  },
  staticSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '40%',
    backgroundColor: LightColors.primary,
  },
});
