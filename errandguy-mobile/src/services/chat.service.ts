import api from './api';

export const chatService = {
  getMessages(
    bookingId: string,
    params?: { page?: number; per_page?: number },
  ) {
    return api.get(`/chat/${bookingId}/messages`, { params });
  },

  sendMessage(bookingId: string, data: { content?: string; image_url?: string }) {
    return api.post(`/chat/${bookingId}/messages`, data);
  },

  markAsRead(bookingId: string) {
    return api.post(`/chat/${bookingId}/read`);
  },
};
