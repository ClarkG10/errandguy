import { useEffect, useCallback, useState, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { chatService } from '../services/chat.service';
import { useSmartPolling } from './useSmartPolling';
import { CacheService, CacheTTL } from '../services/cache.service';
import { echo, retainChannel, releaseChannel } from '../services/echo';
import { useAuthStore } from '../stores/authStore';
import type { Message } from '../types';

/** Min gap between outgoing typing broadcasts. Keystrokes arrive every
 *  ~100ms; one broadcast every 2s is plenty since the receiver holds the
 *  indicator for TYPING_HOLD_MS after each event. */
const TYPING_THROTTLE_MS = 2_000;
/** How long the "typing…" indicator stays lit after the last event.
 *  Longer than the sender throttle so continuous typing never flickers. */
const TYPING_HOLD_MS = 3_500;

/** Per-booking cache key for the most recent page of messages. */
const cacheKey = (bookingId: string) => `chat:messages:${bookingId}`;

// Stable reference for chats that have no messages yet. Returning a
// fresh `[]` on every render forces the chat FlatList's `data` prop
// to change identity, which in turn re-renders every visible bubble
// on every unrelated chat-store update (incoming push to another
// booking, unread-count refresh, etc.). One module-level constant
// fixes the entire downstream re-render storm.
const EMPTY_MESSAGES: Message[] = [];

export function useChat(bookingId: string) {
  // Per-field selectors. The previous form — `useChatStore()` with no
  // selector — subscribed every consumer of this hook to EVERY change
  // in the store, so an incoming push to chat A re-rendered every
  // open chat B, re-ran every effect (including the realtime channel
  // teardown/setup), and re-allocated every callback. Per-field
  // subscriptions only fire when that specific slice changes; action
  // refs are stable across renders by definition (zustand creates
  // them once at store init), so consuming components stay calm.
  const bookingMessages = useChatStore(
    (s) => s.messages[bookingId] ?? EMPTY_MESSAGES,
  );
  const unreadCount = useChatStore((s) => s.unreadCount);
  const isTyping = useChatStore((s) => s.typingByBooking[bookingId] ?? false);
  const addMessage = useChatStore((s) => s.addMessage);
  const replaceMessage = useChatStore((s) => s.replaceMessage);
  const removeMessage = useChatStore((s) => s.removeMessage);
  const setMessages = useChatStore((s) => s.setMessages);
  const markRead = useChatStore((s) => s.markRead);
  const setIsTyping = useChatStore((s) => s.setIsTyping);

  // Cursor + has-more tracker for infinite-scroll-back. Reset whenever
  // the bookingId switches so a new conversation starts at the head.
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursorRef = useRef<string | null>(null);

  // ── Cache hydration ──
  // Paint the most recent page from disk on mount so re-opening a chat
  // shows the conversation instantly. The network refresh below then
  // overwrites with the latest server state. Without this, every
  // navigation back into a chat blanked the screen for ~300ms.
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    (async () => {
      const cached = await CacheService.get<Message[]>(cacheKey(bookingId));
      if (cancelled || !cached || cached.length === 0) return;
      // Only hydrate if the store doesn't already have something for
      // this booking — otherwise we'd clobber freshly streamed messages.
      const current = useChatStore.getState().messages[bookingId] ?? [];
      if (current.length === 0) {
        setMessages(bookingId, cached);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, setMessages]);

  const fetchMessages = useCallback(async () => {
    const response = await chatService.getMessages(bookingId, { limit: 50 });
    const data = response.data?.data ?? [];
    const meta = response.data?.meta ?? {};
    setMessages(bookingId, data);
    setHasMore(!!meta.has_more);
    cursorRef.current = meta.next_before ?? null;
    // Persist the latest page so the next mount can hydrate instantly.
    CacheService.set(cacheKey(bookingId), data, CacheTTL.LONG);
  }, [bookingId, setMessages]);

  /**
   * Load the previous page of older messages and PREPEND them to the
   * current list. Safe to spam-call from FlatList's onEndReached —
   * concurrent calls are deduped via `loadingOlder`.
   */
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || !cursorRef.current) return;
    setLoadingOlder(true);
    try {
      const response = await chatService.getMessages(bookingId, {
        before: cursorRef.current,
        limit: 50,
      });
      const older: Message[] = response.data?.data ?? [];
      const meta = response.data?.meta ?? {};
      // Prepend while deduping by id (Realtime might have already
      // delivered some of these if the user scrolled back into a window
      // that overlapped a recent push).
      const existing = useChatStore.getState().messages[bookingId] ?? [];
      const existingIds = new Set(existing.map((m) => m.id));
      const fresh = older.filter((m) => !existingIds.has(m.id));
      setMessages(bookingId, [...fresh, ...existing]);
      setHasMore(!!meta.has_more);
      cursorRef.current = meta.next_before ?? null;
    } finally {
      setLoadingOlder(false);
    }
  }, [bookingId, hasMore, loadingOlder, setMessages]);

  const sendMessage = useCallback(
    async (content?: string, image_url?: string) => {
      // Optimistic send — paint the bubble in <16ms with a temporary id
      // so the conversation feels instant. When the API responds we
      // swap the temp for the canonical message; on failure we mark the
      // placeholder as `failed` (preserving the original payload) so the
      // bubble stays put and the user can tap to retry.
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const senderId = useAuthStore.getState().user?.id ?? '';
      const placeholder: Message = {
        id: tempId,
        booking_id: bookingId,
        sender_id: senderId,
        content: content ?? null,
        image_url: image_url ?? null,
        is_system: false,
        created_at: new Date().toISOString(),
        read_at: null,
        pending: true,
        retry_payload: { content, image_uri: undefined },
      };
      addMessage(bookingId, placeholder);
      try {
        const response = await chatService.sendMessage(bookingId, {
          content,
          image_url,
        });
        replaceMessage(bookingId, tempId, response.data.data);
      } catch (err) {
        // Convert the placeholder into a "failed" bubble instead of
        // removing it so the user can tap retry without retyping.
        replaceMessage(bookingId, tempId, {
          ...placeholder,
          pending: false,
          failed: true,
        });
        throw err;
      }
    },
    [bookingId, addMessage, replaceMessage],
  );

  /**
   * Send a message with an inline image. The local file URI is uploaded
   * via multipart, the server returns the persisted message including
   * the canonical CDN url. We add it to the local store so the sender
   * sees it immediately even if Realtime takes a moment to fan out.
   */
  const sendMessageWithImage = useCallback(
    async (imageUri: string, content?: string) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const senderId = useAuthStore.getState().user?.id ?? '';
      const placeholder: Message = {
        id: tempId,
        booking_id: bookingId,
        sender_id: senderId,
        content: content ?? null,
        // Show the local file URI so the user sees the photo while the
        // upload completes — the canonical CDN URL replaces it on success.
        image_url: imageUri,
        is_system: false,
        created_at: new Date().toISOString(),
        read_at: null,
        pending: true,
        retry_payload: { content, image_uri: imageUri },
      };
      addMessage(bookingId, placeholder);
      try {
        const response = await chatService.sendMessageWithImage(bookingId, {
          imageUri,
          content,
        });
        replaceMessage(bookingId, tempId, response.data.data);
      } catch (err) {
        replaceMessage(bookingId, tempId, {
          ...placeholder,
          pending: false,
          failed: true,
        });
        throw err;
      }
    },
    [bookingId, addMessage, replaceMessage],
  );

  /**
   * Re-send a previously-failed message. Drops the old failed bubble
   * and dispatches the original payload through the normal optimistic
   * pipeline so it gets a fresh `pending` state.
   */
  const retryMessage = useCallback(
    async (failedId: string) => {
      const list = useChatStore.getState().messages[bookingId] ?? [];
      const target = list.find((m) => m.id === failedId);
      if (!target || !target.failed) return;
      removeMessage(bookingId, failedId);
      const payload = target.retry_payload ?? {};
      try {
        if (payload.image_uri) {
          await sendMessageWithImage(payload.image_uri, payload.content);
        } else {
          await sendMessage(payload.content);
        }
      } catch {
        /* the send helpers re-add their own failed placeholder */
      }
    },
    [bookingId, removeMessage, sendMessage, sendMessageWithImage],
  );

  const markAsRead = useCallback(async () => {
    // Apply-first: clear the unread badge + stamp read_at locally instantly,
    // then fire the (idempotent) receipt in the background. It's auto-retried
    // on every chat open / foreground / scroll-to-live-edge, so a dropped
    // request self-heals — no rollback needed.
    markRead(bookingId);
    chatService.markAsRead(bookingId).catch(() => {});
  }, [bookingId, markRead]);

  // Live channel ref so sendTyping() can whisper on whatever channel
  // is currently subscribed without re-creating callbacks per effect run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);

  useEffect(() => {
    if (!bookingId) return;

    const channelName = `chat.${bookingId}`;
    const channel = echo.private(channelName);
    retainChannel(channelName);
    channelRef.current = channel;

    // New chat message — mirrors MessageResource (sender loaded). The store
    // dedupes by id, so the sender's own echoed message is harmless.
    const onMessage = (payload: Message) => {
      addMessage(bookingId, payload);
    };
    channel.listen('.message.created', onMessage);

    // Typing indicator — a pure client event (whisper), no backend involvement.
    // The sender whispers `{ userId }`; anyone else on the channel lights the
    // indicator and auto-clears it TYPING_HOLD_MS after the last event (each
    // event resets the timer, so continuous typing holds).
    const onTyping = (payload: { userId?: string } | null) => {
      const fromUserId = payload?.userId;
      const myId = useAuthStore.getState().user?.id;
      if (!fromUserId || fromUserId === myId) return;
      setIsTyping(bookingId, true);
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      typingClearRef.current = setTimeout(() => {
        setIsTyping(bookingId, false);
        typingClearRef.current = null;
      }, TYPING_HOLD_MS);
    };
    channel.listenForWhisper('typing', onTyping);

    return () => {
      channel.stopListening('.message.created', onMessage);
      channel.stopListeningForWhisper('typing', onTyping);
      channelRef.current = null;
      if (typingClearRef.current) {
        clearTimeout(typingClearRef.current);
        typingClearRef.current = null;
      }
      // Never leave a stale "typing…" lit when the thread closes.
      setIsTyping(bookingId, false);
      releaseChannel(channelName);
    };
  }, [bookingId, addMessage, setIsTyping]);

  /**
   * Whisper a throttled "I'm typing" event to the other participant.
   * Call from the composer's onChangeText — internally rate-limited to
   * one whisper per TYPING_THROTTLE_MS so keystrokes stay cheap.
   * Fire-and-forget; delivery failures are silently ignored.
   */
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    try {
      channelRef.current?.whisper('typing', { userId });
    } catch {
      /* whispers are best-effort */
    }
  }, []);

  // Realtime fallback. The private Reverb chat channel above is the primary
  // push path, but it depends on the socket staying live and the
  // broadcasting-auth handshake (Laravel Sanctum) succeeding — if the channel
  // drops or auth fails, pushes silently never arrive. Polling closes that
  // gap. At 8s (not 2s) it's a light fallback; useSmartPolling additionally
  // pauses it while backgrounded/offline, ticks immediately on foreground +
  // reconnect, and backs off (up to 32s) if getMessages starts failing.
  const pollMessages = useCallback(async () => {
    // Forward-delta poll: ask only for messages NEWER than the newest we
    // already hold (`after=<id>`), instead of re-downloading the whole 50-row
    // head page every 8s and deduping client-side. Usually ships an empty
    // list; the ETag layer then collapses those unchanged ticks to a 304.
    // Falls back to a full head-page fetch when the store is empty (first
    // open). Bypass the micro-cache so each tick reaches the network; errors
    // propagate so useSmartPolling's backoff engages.
    const existing = useChatStore.getState().messages[bookingId] ?? [];
    const newestId = existing.length ? existing[existing.length - 1].id : undefined;
    const response = await chatService.getMessages(
      bookingId,
      newestId
        ? { after: newestId, limit: 50, noCache: true }
        : { limit: 50, noCache: true },
    );
    const fresh: Message[] = response.data?.data ?? [];
    if (fresh.length === 0) return;
    const ids = new Set(existing.map((m) => m.id));
    for (const m of fresh) {
      if (!ids.has(m.id)) addMessage(bookingId, m);
    }
  }, [bookingId, addMessage]);

  useSmartPolling(pollMessages, {
    interval: 8_000,
    enabled: !!bookingId,
    runOnMount: true,
    pauseWhenOffline: true,
    backoffOnError: true,
    maxInterval: 32_000,
  });

  // Persist the live store to disk whenever the message list changes.
  // Throttled by trailing-edge effect debounce: we only write when the
  // length stops changing for ~3s so a burst of incoming pushes
  // collapses into a single AsyncStorage write. Previously this fired
  // every 600ms which on a busy chat meant a JSON.stringify + bridge
  // write of up to 100 message rows roughly every push — enough to
  // visibly stall the JS thread on mid-tier Android devices.
  useEffect(() => {
    if (!bookingId) return;
    const handle = setTimeout(() => {
      const list = useChatStore.getState().messages[bookingId];
      if (!list || list.length === 0) return;
      // Cap the cached page so the on-disk payload stays small. The
      // hydration path only needs the most recent window — older history
      // is fetched on-demand via loadOlder().
      const window = list.slice(-100);
      CacheService.set(cacheKey(bookingId), window, CacheTTL.LONG);
    }, 3_000);
    return () => clearTimeout(handle);
  }, [bookingId, bookingMessages.length]);

  return {
    messages: bookingMessages,
    unreadCount,
    isTyping,
    fetchMessages,
    loadOlder,
    hasMore,
    loadingOlder,
    sendMessage,
    sendMessageWithImage,
    retryMessage,
    markAsRead,
    setIsTyping,
    sendTyping,
  };
}
