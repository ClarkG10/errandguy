import { useAuthStore } from '../stores/authStore';

/**
 * Inbox swipe-deletes waiting out their Undo window, keyed by notification id.
 * Shared by the customer and runner inboxes.
 *
 * Kept outside the screens on purpose. The "Notification deleted · Undo" toast
 * is global and outlives the inbox; while the timers lived in a screen's ref,
 * leaving the inbox sent every pending delete at once and forgot it, so tapping
 * Undo on the next screen did nothing. Here a delete goes out when its window
 * closes, wherever the person is by then, and Undo works for as long as it
 * shows. The callbacks only reach the service, the global store and toasts —
 * never a screen's state.
 *
 * Signing out cancels them all: the token is gone by the time a window closes,
 * so the delete could only fail, and its "Couldn't delete notification" toast
 * would land on the login screen.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const pendingNotificationDeletes = {
  /** Run `send` after `delayMs`, unless cancelled first. */
  schedule(id: string, delayMs: number, send: () => void): void {
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        send();
      }, delayMs),
    );
  },

  /** Cancel one. True while it was still waiting — i.e. Undo still applies. */
  cancel(id: string): boolean {
    const timer = timers.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    timers.delete(id);
    return true;
  },

  cancelAll(): void {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  },
};

// Every way a session ends flips isAuthenticated off (sign-out, a 401, a dead
// account), so this one edge covers them all.
useAuthStore.subscribe((state, prev) => {
  if (prev.isAuthenticated && !state.isAuthenticated) pendingNotificationDeletes.cancelAll();
});
