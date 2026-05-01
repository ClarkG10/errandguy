import { useEffect, useState } from 'react';
import { AccessibilityInfo, type AccessibilityInfoStatic } from 'react-native';

/**
 * Live tracker for the OS-level "Reduce Motion" accessibility setting.
 *
 * iOS: Settings → Accessibility → Motion → Reduce Motion.
 * Android: Settings → Accessibility → Remove animations (API 31+).
 *
 * Components should branch on this to:
 *   - Skip purely decorative shimmer / spring / parallax animations.
 *   - Cut transition durations to 0 (snap, don't animate).
 *   - Replace cross-fades with instant swaps.
 *
 * Subscribes to `reduceMotionChanged` so toggling the setting in
 * Settings.app immediately quiets every consumer without an app
 * restart. Defaults to `false` until the first async resolution
 * completes — fine for the first frame because animation choices
 * usually happen in `useEffect` after that.
 */
export function useReducedMotion(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    (AccessibilityInfo as AccessibilityInfoStatic)
      .isReduceMotionEnabled?.()
      .then((value) => {
        if (mounted) setEnabled(!!value);
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value: boolean) => {
        if (mounted) setEnabled(value);
      },
    );

    return () => {
      mounted = false;
      // RN ≥0.65 returns an EmitterSubscription with `.remove()`. The
      // optional chain keeps us compatible with the older boolean-style
      // return value just in case.
      sub?.remove?.();
    };
  }, []);

  return enabled;
}
