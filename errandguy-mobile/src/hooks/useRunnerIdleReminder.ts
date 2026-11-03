import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * How long after the app goes to the background the runner is reminded.
 *
 * Location only streams while ErrandGuy is open (background location is
 * deliberately not implemented), and matching stops considering a runner whose
 * last location is 15 minutes old (MatchingService; DISPATCH_STALE_AFTER_MS in
 * stores/locationStore). The server's own "you're offline now" push comes at
 * 30 minutes — a quarter of an hour after offers had already stopped. Twelve
 * minutes leaves time to act before matching drops them.
 */
export const IDLE_REMINDER_AFTER_SECONDS = 12 * 60;

/** Fixed id, so a second backgrounding replaces the first and one cancel clears it. */
export const IDLE_REMINDER_ID = 'runner-idle-reminder';

/**
 * Bumped by every cancel, so a schedule still waiting on the native side when
 * the app came back to the front (or the runner went offline) can tell it was
 * overtaken and doesn't leave a reminder behind.
 */
let generation = 0;

function cancelReminder(): void {
  generation += 1;
  Notifications.cancelScheduledNotificationAsync(IDLE_REMINDER_ID).catch(() => {});
}

async function scheduleReminder(): Promise<void> {
  const gen = generation;
  // Replace, never stack.
  await Notifications.cancelScheduledNotificationAsync(IDLE_REMINDER_ID).catch(() => {});
  if (gen !== generation) return;
  await Notifications.scheduleNotificationAsync({
    identifier: IDLE_REMINDER_ID,
    content: {
      title: 'You’re still online',
      body: 'Open ErrandGuy to keep getting errands.',
      // No `type`: a tap just opens the app where the runner left it.
      data: {},
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: IDLE_REMINDER_AFTER_SECONDS,
      // The app's one Android channel (created in hooks/useNotifications).
      channelId: 'default',
    },
  });
  // A cancel ran while this was being scheduled, so it missed it. Unless the
  // app has gone to the background again since (whose own schedule replaced
  // this one under the same id), take it back out.
  if (gen !== generation && AppState.currentState !== 'background') {
    await Notifications.cancelScheduledNotificationAsync(IDLE_REMINDER_ID).catch(() => {});
  }
}

/**
 * A local "open the app" reminder for a runner who is online and waiting —
 * not on an errand — when ErrandGuy goes to the background (screen locked,
 * another app opened). Scheduled on the way out; cancelled the moment the app
 * is back in front, the runner goes offline, an errand starts, or the screen
 * that owns it unmounts. A local notification needs no server and no new
 * native module (expo-notifications already ships), and fails silently where
 * notifications are off — the Home screen already says so in that case.
 */
export function useRunnerIdleReminder(active: boolean): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!active) {
      cancelReminder();
      return;
    }
    // Back in the app (or never left): nothing should be pending.
    cancelReminder();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        scheduleReminder().catch(() => {});
      } else if (next === 'active') {
        cancelReminder();
      }
    });
    return () => {
      sub.remove();
      cancelReminder();
    };
  }, [active]);
}
