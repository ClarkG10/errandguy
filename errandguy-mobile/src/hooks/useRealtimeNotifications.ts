import { useCallback } from 'react';
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
