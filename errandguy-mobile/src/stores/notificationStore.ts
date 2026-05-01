import { create } from 'zustand';
import type { AppNotification } from '../types';

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;

  setNotifications: (notifications: AppNotification[]) => void;
  addNotification: (notification: AppNotification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setUnreadCount: (count: number) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,

  // Replace the full list. Recompute the unread badge from the payload
  // itself so a refresh can never leave the badge out of sync with the
  // visible rows (previously a stale unreadCount could survive a list
  // replacement, e.g. after pull-to-refresh hit a server that had since
  // marked everything read).
  setNotifications: (notifications) =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.is_read).length,
    }),

  addNotification: (notification) =>
    set((state) => {
      // De-dupe by id. Realtime INSERT and an explicit refresh fetched
      // around the same time can both deliver the same row; we don't
      // want it stacking twice in the list (or the unread count to
      // double-count). Also: only bump unread if the row isn't already
      // marked read server-side (e.g. the push handler called
      // markRead() before the Realtime fan-out arrived).
      if (state.notifications.some((n) => n.id === notification.id)) {
        return state;
      }
      const isUnread = !notification.is_read;
      return {
        notifications: [notification, ...state.notifications],
        unreadCount: isUnread ? state.unreadCount + 1 : state.unreadCount,
      };
    }),

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

  setUnreadCount: (count) => set({ unreadCount: count }),

  setIsLoading: (loading) => set({ isLoading: loading }),
}));
