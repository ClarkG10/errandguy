import { create } from 'zustand';
import { notificationService } from '../services/notification.service';
import type { AppNotification } from '../types';

interface NotificationState {
  notifications: AppNotification[];
  /**
   * The Alerts badge: the SERVER's unread total (GET /notifications/unread-
   * count), moved by local deltas as rows are read / removed / arrive between
   * reconciles. Never recomputed from `notifications` — that is one page (and,
   * on the customer inbox, one category) of the inbox, so counting it reset a
   * badge of 34 to the 3 unread rows on screen.
   */
  unreadCount: number;
  isLoading: boolean;
  /**
   * Whether the OS will actually deliver a push to this device.
   *
   * Registration used to `return null` on a denial and say nothing — so a
   * runner could go online, be told "You're online and ready for errands",
   * and never hear about a single offer, because a push is the only channel
   * that reaches a phone in a pocket. The denial was invisible to the app and
   * unrecoverable from inside it.
   *
   * `null` = not determined yet this launch (registration hasn't run, or the
   * platform can't tell us). Treat null as "don't warn" — warning on an
   * unknown is worse than staying quiet.
   */
  pushPermission: 'granted' | 'denied' | null;

  setNotifications: (notifications: AppNotification[]) => void;
  /**
   * Land a realtime row. A NEW id is prepended; an id we already hold is an
   * UPDATE (the server coalesces progress streams — shopping ticks, stop
   * ticks — onto one card and re-broadcasts it with fresh data), so it
   * replaces the held row and moves to the top. Returns whether the id was
   * already held, so the caller knows when the badge delta was a guess.
   */
  addNotification: (notification: AppNotification) => boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  restoreAt: (notification: AppNotification, index: number) => void;
  clear: () => void;
  /** Put back an exact earlier list + badge (rollback of an optimistic bulk action). */
  restore: (notifications: AppNotification[], unreadCount: number) => void;
  setUnreadCount: (count: number) => void;
  /** Re-read the server's unread total into the badge. Never throws. */
  refreshUnreadCount: () => Promise<void>;
  setIsLoading: (loading: boolean) => void;
  setPushPermission: (state: 'granted' | 'denied' | null) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  pushPermission: null,

  // Replace the rows. The badge is deliberately left alone: these rows are a
  // page (or one category) of the inbox, not all of it — the server's total
  // stays the badge (refreshUnreadCount).
  setNotifications: (notifications) => set({ notifications }),

  addNotification: (notification) => {
    let held = false;
    set((state) => {
      const prev = state.notifications.find((n) => n.id === notification.id);
      held = !!prev;
      if (!prev) {
        return {
          notifications: [notification, ...state.notifications],
          unreadCount: notification.is_read ? state.unreadCount : state.unreadCount + 1,
        };
      }
      // The coalesced card came round again: newest content, newest position.
      // The badge moves only if the read state did (the server re-marks an
      // updated card unread).
      const delta = (prev.is_read ? 0 : -1) + (notification.is_read ? 0 : 1);
      return {
        notifications: [notification, ...state.notifications.filter((n) => n.id !== notification.id)],
        unreadCount: Math.max(0, state.unreadCount + delta),
      };
    });
    return held;
  },

  markRead: (id) =>
    set((state) => {
      const target = state.notifications.find((n) => n.id === id);
      // Idempotent: marking an already-read notification is a no-op so
      // the unread counter can't drift below zero on duplicate calls.
      if (!target || target.is_read) return state;
      return {
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, is_read: true } : n,
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    }),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    })),

  // Drop a single row (delete/archive). Decrement the unread badge only
  // when the removed row was actually unread so the counter can't drift
  // below zero — mirrors markRead's idempotency guarantee.
  remove: (id) =>
    set((state) => {
      const target = state.notifications.find((n) => n.id === id);
      if (!target) return state;
      const wasUnread = !target.is_read;
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount: wasUnread
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
      };
    }),

  // Re-insert a single row at its original position — used for
  // undo-delete and for rolling back a failed swipe action. Restoring
  // only the affected item (instead of a pre-action full snapshot)
  // means a rollback can't resurrect rows that were removed
  // concurrently and have already been deleted server-side.
  restoreAt: (notification, index) =>
    set((state) => {
      // De-dupe: Realtime or a refetch may have already re-delivered it.
      if (state.notifications.some((n) => n.id === notification.id)) {
        return state;
      }
      const next = [...state.notifications];
      next.splice(
        Math.min(Math.max(index, 0), next.length),
        0,
        notification,
      );
      return {
        notifications: next,
        unreadCount: !notification.is_read
          ? state.unreadCount + 1
          : state.unreadCount,
      };
    }),

  // Wipe the whole list (clear-all deletes every notification server-side,
  // and sign-out ends the account's inbox). Badge resets to zero.
  clear: () => set({ notifications: [], unreadCount: 0 }),

  restore: (notifications, unreadCount) => set({ notifications, unreadCount }),

  setUnreadCount: (count) => set({ unreadCount: Math.max(0, Number(count) || 0) }),

  refreshUnreadCount: async () => {
    try {
      const response = await notificationService.getUnreadCount();
      const count = response?.data?.data?.unread_count;
      if (typeof count === 'number') set({ unreadCount: Math.max(0, count) });
    } catch {
      // Keep the current badge; the next foreground / event reconciles.
    }
  },

  setIsLoading: (loading) => set({ isLoading: loading }),

  setPushPermission: (state) => set({ pushPermission: state }),
}));
