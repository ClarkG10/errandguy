import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Speak a form field's validation error — iOS only, batched per commit.
 *
 * WHY IT EXISTS
 * `Input` renders its error with `accessibilityLiveRegion="polite"` and
 * `accessibilityRole="alert"`. Both are Android-only announcement mechanisms
 * in React Native — RN maps role 'alert' to no iOS trait — so on iOS a
 * rejected form was completely silent. iOS therefore needs an explicit
 * `AccessibilityInfo.announceForAccessibility`, and Android must NOT get one
 * or it speaks twice.
 *
 * WHY IT BATCHES
 * A submit-time validation failure sets every invalid field at once (one
 * react-hook-form commit, or one `applyServerErrors` loop over a 422 body), so
 * every `Input` on the form fires in the same tick. iOS announcements
 * interrupt each other, so the register form's five errors would leave the
 * user hearing only the LAST field — the least useful one, and with no hint
 * that four others failed. Collecting the tick and speaking
 * "5 fields need attention. First name, error: …" tells the truth and points
 * at the field to start from (`pending[0]` is the topmost field on screen,
 * because effects run in mount order).
 *
 * A single error is spoken verbatim, with no count prefix.
 */
let pending: string[] = [];
let scheduled = false;

export function announceFieldError(message: string): void {
  // Android already announces via the live region on the error Text.
  if (Platform.OS !== 'ios') return;
  if (!message) return;

  pending.push(message);
  if (scheduled) return;
  scheduled = true;

  // Microtask, not a timer: React flushes all of a commit's effects inside one
  // task, so this runs once after the last field has queued itself — no delay
  // the user can perceive, and no dependency on fake timers in tests.
  queueMicrotask(() => {
    const batch = pending;
    pending = [];
    scheduled = false;
    if (batch.length === 0) return;
    AccessibilityInfo.announceForAccessibility(
      batch.length === 1
        ? batch[0]
        : `${batch.length} fields need attention. ${batch[0]}`,
    );
  });
}
