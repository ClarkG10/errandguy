import api from './api';
import { invalidateQuery } from '../hooks/useQuery';
import type { Conversation } from '../types';

const invalidateChat = (bookingId?: string) => {
  invalidateQuery(['chat', 'unread']);
  invalidateQuery(['chat', 'conversations']);
  if (bookingId) invalidateQuery(['chat', bookingId]);
};

export const chatService = {
  getMessages(
    bookingId: string,
    params?: { before?: string; limit?: number; noCache?: boolean },
  ) {
    // Realtime channel pushes new messages, so we can cache aggressively.
    // NOTE: do not cache cursor-paginated requests — only the head page.
    // `noCache` lets the polling fallback bypass the micro-cache so it
    // can actually discover newly-arrived messages on every tick.
    const isHeadPage = !params?.before;
    const { noCache, ...query } = params ?? {};
    return api.get(`/chat/${bookingId}/messages`, {
      params: query,
      ...(isHeadPage && !noCache ? { cacheTtlMs: 10_000 } : {}),
      ...(noCache ? { noCache: true } : {}),
    } as any);
  },

  sendMessage(bookingId: string, data: { content?: string; image_url?: string }) {
    const p = api.post(`/chat/${bookingId}/messages`, data);
    p.then(() => invalidateChat(bookingId)).catch(() => {});
    return p;
  },

  /**
   * Send a message with an inline image upload (multipart). The local
   * file URI from expo-image-picker / camera is streamed to the server
   * which stores it on the public disk and returns the canonical URL.
   * Use this instead of `sendMessage({ image_url: 'file://...' })` — the
   * server will reject local URIs and the message would never persist.
   */
  sendMessageWithImage(
    bookingId: string,
    params: { content?: string; imageUri: string },
  ) {
    const form = new FormData();
    if (params.content?.trim()) {
      form.append('content', params.content.trim());
    }
    // Best-effort mime sniff from extension; server validates anyway.
    const ext = params.imageUri.split('.').pop()?.toLowerCase() || 'jpg';
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    form.append('image', {
      uri: params.imageUri,
      type,
      name: `chat.${ext === 'jpeg' ? 'jpg' : ext}`,
    } as any);
    const p = api.post(`/chat/${bookingId}/messages`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    p.then(() => invalidateChat(bookingId)).catch(() => {});
    return p;
  },

  markAsRead(bookingId: string) {
    const p = api.post(`/chat/${bookingId}/read`);
    p.then(() => invalidateChat(bookingId)).catch(() => {});
    return p;
  },

  getUnreadCount() {
    // Silent: refreshed every 30s on a foreground interval; the user
    // never asked for it, so it shouldn't trigger the loader bar.
    return api.get<{
      data: { total: number; by_booking: Record<string, number> };
    }>('/chat/unread-count', { cacheTtlMs: 10_000, silent: true } as any);
  },

  getConversations() {
    // Silent: refreshed on focus / interval; the user did not ask for
    // it explicitly so it shouldn't paint the global progress bar.
    return api.get<{ data: Conversation[] }>('/chat/conversations', {
      cacheTtlMs: 15_000,
      silent: true,
    } as any);
  },
};
