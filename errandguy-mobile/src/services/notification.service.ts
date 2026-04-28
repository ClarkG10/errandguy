import api from './api';
import { invalidateQuery } from '../hooks/useQuery';

const invalidateNotifications = () => invalidateQuery(['notifications']);

export const notificationService = {
  getNotifications(params?: { page?: number; per_page?: number }) {
    return api.get('/notifications', { params, cacheTtlMs: 15_000 } as any);
  },

  getUnreadCount() {
    return api.get('/notifications/unread-count', { cacheTtlMs: 15_000 } as any);
  },

  markAsRead(id: string) {
    const p = api.put(`/notifications/${id}/read`);
    p.then(invalidateNotifications).catch(() => {});
    return p;
  },

  markAllAsRead() {
    const p = api.put('/notifications/read-all');
    p.then(invalidateNotifications).catch(() => {});
    return p;
  },
};
