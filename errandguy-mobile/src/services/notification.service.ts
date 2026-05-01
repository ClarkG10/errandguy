import api from './api';
import { invalidateQuery } from '../hooks/useQuery';

const invalidateNotifications = () => invalidateQuery(['notifications']);

export const notificationService = {
  getNotifications(params?: { page?: number; per_page?: number }) {
    // Only cache the head page (page 1 with default per_page) — deeper
    // pages are stable history fetched on demand and don't benefit
    // from a 15s window cache.
    const isHeadPage = !params || (!params.page || params.page === 1);
    return api.get('/notifications', {
      params,
      ...(isHeadPage ? { cacheTtlMs: 15_000 } : {}),
    } as any);
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
