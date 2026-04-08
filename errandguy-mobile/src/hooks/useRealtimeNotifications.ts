import { useCallback } from 'react';
import { useSupabaseRealtime } from './useSupabaseRealtime';
import { useNotificationStore } from '../stores/notificationStore';
import { notificationService } from '../services/notification.service';
import type { AppNotification } from '../types';

export function useRealtimeNotifications(userId: string | null) {
  const { addNotification, setUnreadCount } = useNotificationStore();

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await notificationService.getUnreadCount();
      setUnreadCount(response.data.data.unread_count);
    } catch {
      // silently fail
    }
  }, [setUnreadCount]);

  const { isConnected } = useSupabaseRealtime({
    channel: `notifications:${userId}`,
    table: 'notifications',
    event: 'INSERT',
    filter: userId ? `user_id=eq.${userId}` : undefined,
    onPayload: (payload) => {
      addNotification(payload.new as AppNotification);
    },
  });

  return { isConnected, fetchUnreadCount };
}
