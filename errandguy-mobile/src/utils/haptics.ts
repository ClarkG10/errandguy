/**
 * Thin wrapper over expo-haptics, mirroring the `toast.*` shorthand so feedback
 * intent reads consistently across the app: `haptics.success()` next to a
 * success toast, `haptics.error()` next to an error toast, etc.
 *
 * Why this exists: expo-haptics was imported and called directly in ~80 files,
 * each repeating the `.catch(() => {})` swallow and picking its own feedback
 * type ad-hoc. Centralizing gives one swallow point and a single future home
 * for a "reduce haptics" accessibility setting.
 *
 * Do NOT auto-couple this into `toast.*` — many sites already call both, and
 * coupling would double-fire. Keep them explicit but adjacent.
 */
import * as Haptics from 'expo-haptics';
import { usePreferencesStore } from '../stores/preferencesStore';

// Haptics can reject on web / unsupported devices; feedback is never critical,
// so every call is fire-and-forget with the rejection swallowed.
//
// The thunk (not a Promise) is deliberate: the "Reduce Haptics" accessibility
// preference is checked BEFORE the effect is invoked, so a quieted device never
// even asks the OS to buzz. Reading the store via `getState()` keeps this a
// plain module (no React) — the guard is one additive line, callers unchanged.
const fire = (make: () => Promise<void>): void => {
  try {
    if (usePreferencesStore.getState().reduceHaptics) return;
  } catch {
    // Store not ready / unavailable — fall through and buzz as before.
  }
  void make().catch(() => {});
};

export const haptics = {
  /** A completed action (payment confirmed, booking placed, saved). */
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** A cautionary or destructive-intent moment (confirm delete, validation stop). */
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** A failure the user should feel (payment failed, request rejected). */
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** Discrete UI selection (toggle, picker, tab, segmented control). */
  selection: () => fire(() => Haptics.selectionAsync()),
  /** Light physical tap (button press, small confirm). */
  light: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Medium tap (sheet open, meaningful press). */
  medium: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Heavy tap (slide-to-confirm complete, strong commit). */
  heavy: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
};
