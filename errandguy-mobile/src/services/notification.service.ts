import api from './api';

export const notificationService = {
  getNotifications(params?: { page?: number; per_page?: number }) {
    return api.get('/notifications', { params });
  },

  getUnreadCount() {
    return api.get('/notifications/unread-count');
  },

  markAsRead(id: string) {
    return api.put(`/notifications/${id}/read`);
  },

  markAllAsRead() {
    return api.put('/notifications/read-all');
  },
};
