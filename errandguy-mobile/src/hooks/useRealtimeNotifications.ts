import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useEchoChannel } from './useEchoChannel';
import { useNotificationStore } from '../stores/notificationStore';
import { notificationService } from '../services/notification.service';
import type { AppNotification } from '../types';

export function useRealtimeNotifications(userId: string | null) {
  // Per-field selectors — this hook is mounted app-wide; a whole-store
  // useNotificationStore() would re-run it on every notification add/read.
  const addNotification = useNotificationStore((s) => s.addNotification);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await notificationService.getUnreadCount();
      setUnreadCount(response.data.data.unread_count);
    } catch {
      // silently fail
    }
  }, [setUnreadCount]);

  // Seed + keep the tab badge authoritative from /notifications/unread-count.
  // Without this the badge started at 0 and only reflected realtime increments
  // (and whatever the Alerts list had loaded), so a cold start with N unread
  // showed nothing — or an early push showed "1" instead of "N+1" — until the
  // user opened the list. Re-sync on foreground since a notification may have
  // been read/added on another device (or via a tapped push) while backgrounded.
  useEffect(() => {
    if (!userId) return;
    void fetchUnreadCount();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void fetchUnreadCount();
    });
    return () => sub.remove();
  }, [userId, fetchUnreadCount]);

  const { isConnected } = useEchoChannel({
    channel: `notifications.${userId}`,
    event: 'notification.created',
    enabled: !!userId,
    // Payload mirrors NotificationResource exactly (delivered directly, not in
    // any `{ new }` change envelope), so it drops straight into the store.
    onEvent: (payload) => {
      addNotification(payload as AppNotification);
    },
  });

  return { isConnected, fetchUnreadCount };
}
