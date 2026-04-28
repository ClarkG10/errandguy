import api from './api';
import { invalidateQuery } from '../hooks/useQuery';

const invalidateChat = (bookingId?: string) => {
  invalidateQuery(['chat', 'unread']);
  if (bookingId) invalidateQuery(['chat', bookingId]);
};

export const chatService = {
  getMessages(
    bookingId: string,
    params?: { page?: number; per_page?: number },
  ) {
    // Realtime channel pushes new messages, so we can cache aggressively.
    return api.get(`/chat/${bookingId}/messages`, { params, cacheTtlMs: 10_000 } as any);
  },

  sendMessage(bookingId: string, data: { content?: string; image_url?: string }) {
    const p = api.post(`/chat/${bookingId}/messages`, data);
    p.then(() => invalidateChat(bookingId)).catch(() => {});
    return p;
  },

  markAsRead(bookingId: string) {
    const p = api.post(`/chat/${bookingId}/read`);
    p.then(() => invalidateChat(bookingId)).catch(() => {});
    return p;
  },

  getUnreadCount() {
    return api.get<{
      data: { total: number; by_booking: Record<string, number> };
    }>('/chat/unread-count', { cacheTtlMs: 10_000 } as any);
  },
};
