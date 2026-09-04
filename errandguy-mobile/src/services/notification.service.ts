import api from './api';
import { invalidateQuery } from '../hooks/useQuery';

const invalidateNotifications = () => invalidateQuery(['notifications']);

export const notificationService = {
  getNotifications(params?: {
    page?: number;
    per_page?: number;
    /** Comma-separated notification types for the inbox category chips. */
    types?: string;
  }) {
    // Only cache the head page (page 1 with default per_page) — deeper
    // pages are stable history fetched on demand and don't benefit
    // from a 15s window cache.
    const isHeadPage = !params || (!params.page || params.page === 1);
    return api.get('/notifications', {
      params,
      silent: true,
      ...(isHeadPage ? { cacheTtlMs: 15_000 } : {}),
    });
  },

  getUnreadCount() {
    return api.get('/notifications/unread-count', { cacheTtlMs: 15_000, silent: true });
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

  deleteNotification(id: string) {
    const p = api.delete(`/notifications/${id}`);
    p.then(invalidateNotifications).catch(() => {});
    return p;
  },

  clearAll() {
    const p = api.delete('/notifications');
    p.then(invalidateNotifications).catch(() => {});
    return p;
  },

  archiveNotification(id: string) {
    const p = api.put(`/notifications/${id}/archive`);
    p.then(invalidateNotifications).catch(() => {});
    return p;
  },

  unarchiveNotification(id: string) {
    const p = api.put(`/notifications/${id}/unarchive`);
    p.then(invalidateNotifications).catch(() => {});
    return p;
  },
};
