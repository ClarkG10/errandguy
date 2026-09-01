import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import api from './api';
import { invalidateQuery } from '../hooks/useQuery';
import type { Conversation } from '../types';

/** Longest edge we upload for chat photos. Anything bigger is wasted
 *  bandwidth — bubbles render at ~220pt and the lightbox rarely needs
 *  more than the screen's long edge. */
const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.7;

/**
 * Downscale + recompress a local photo before upload. A modern phone
 * camera shot is 4000px / 3-6 MB; resizing to 1600px @ 0.7 JPEG cuts
 * that to ~200-400 KB with no visible loss at chat sizes — a pure win
 * for send latency on both the customer and runner threads.
 *
 * Best-effort: any failure (unreadable file, missing native module)
 * falls back to the original URI so a send never breaks on compression.
 */
async function compressChatImage(
  uri: string,
): Promise<{ uri: string; compressed: boolean }> {
  try {
    const { width, height } = await new Promise<{ width: number; height: number }>(
      (resolve, reject) =>
        Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject),
    );
    const context = ImageManipulator.manipulate(uri);
    if (Math.max(width, height) > MAX_IMAGE_EDGE) {
      // Only pass the long edge — the other dimension is derived so the
      // aspect ratio is preserved (and we never upscale small images).
      context.resize(
        width >= height ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE },
      );
    }
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    return { uri: result.uri, compressed: true };
  } catch {
    return { uri, compressed: false };
  }
}

const invalidateChat = (bookingId?: string) => {
  invalidateQuery(['chat', 'unread']);
  invalidateQuery(['chat', 'conversations']);
  if (bookingId) invalidateQuery(['chat', bookingId]);
};

export const chatService = {
  getMessages(
    bookingId: string,
    params?: { before?: string; after?: string; limit?: number; noCache?: boolean },
  ) {
    // Realtime channel pushes new messages, so we can cache aggressively.
    // NOTE: do not cache cursor requests — only the head page. `before`
    // loads older history; `after=<message id>` is the forward-delta poll
    // (ships just what's new). `noCache` lets the polling fallback bypass
    // the micro-cache so it can discover newly-arrived messages every tick.
    const isHeadPage = !params?.before && !params?.after;
    const { noCache, ...query } = params ?? {};
    return api.get(`/chat/${bookingId}/messages`, {
      params: query,
      ...(isHeadPage && !noCache ? { cacheTtlMs: 10_000 } : {}),
      ...(noCache ? { noCache: true } : {}),
    });
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
  async sendMessageWithImage(
    bookingId: string,
    params: { content?: string; imageUri: string; onProgress?: (frac: number) => void },
  ) {
    // Resize/recompress before upload (see compressChatImage). The
    // multipart contract below is unchanged — same field names, same
    // endpoint — only the file payload shrinks.
    const { uri: uploadUri, compressed } = await compressChatImage(params.imageUri);
    const form = new FormData();
    if (params.content?.trim()) {
      form.append('content', params.content.trim());
    }
    // Compressed output is always JPEG; otherwise best-effort mime sniff
    // from the extension (server validates anyway).
    const ext = compressed
      ? 'jpg'
      : uploadUri.split('.').pop()?.toLowerCase() || 'jpg';
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    form.append('image', {
      uri: uploadUri,
      type,
      name: `chat.${ext === 'jpeg' ? 'jpg' : ext}`,
    } as any);
    const onProgress = params.onProgress;
    const p = api.post(`/chat/${bookingId}/messages`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
        ? (e: any) => {
            if (e.total) onProgress(e.loaded / e.total);
          }
        : undefined,
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
    //
    // Deliberately UNCACHED. chatStore.refreshUnread — this endpoint's only
    // caller — snapshots its bump sequence BEFORE the request and trusts the
    // response to reflect server state as of that moment: that is what lets it
    // keep a realtime increment that landed mid-flight. A micro-cached body
    // predates the snapshot, so a badge bumped between the cache fill and the
    // next reconcile was "authoritatively" wiped back to the stale count for
    // up to 10s. In-flight dedupe still coalesces concurrent calls.
    return api.get<{
      data: { total: number; by_booking: Record<string, number> };
    }>('/chat/unread-count', { silent: true });
  },

  getConversations() {
    // Silent: refreshed on focus / interval; the user did not ask for
    // it explicitly so it shouldn't paint the global progress bar.
    return api.get<{ data: Conversation[] }>('/chat/conversations', {
      cacheTtlMs: 15_000,
      silent: true,
    });
  },
};
