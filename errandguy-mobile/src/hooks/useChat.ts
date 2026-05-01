import { useEffect, useCallback, useState, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useChatStore } from '../stores/chatStore';
import { chatService } from '../services/chat.service';
import { CacheService, CacheTTL } from '../services/cache.service';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import type { Message } from '../types';

/** Per-booking cache key for the most recent page of messages. */
const cacheKey = (bookingId: string) => `chat:messages:${bookingId}`;

export function useChat(bookingId: string) {
  const {
    messages,
    unreadCount,
    isTyping,
    addMessage,
    replaceMessage,
    removeMessage,
    setMessages,
    markRead,
    setIsTyping,
  } = useChatStore();

  const bookingMessages = messages[bookingId] || [];

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
    await chatService.markAsRead(bookingId);
    markRead(bookingId);
  }, [bookingId, markRead]);

  useEffect(() => {
    // Drop any stale channel registered under this name before opening
    // a fresh one. supabase.channel(name) returns the same singleton
    // when one already exists — if a previous mount hadn't been fully
    // cleaned up yet (StrictMode double-effect, fast remount on route
    // change, hot reload), the returned channel is already SUBSCRIBED
    // and adding listeners after subscribe() throws.
    const stale = supabase
      .getChannels()
      .find((c) => c.topic === `realtime:chat:${bookingId}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase
      .channel(`chat:${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          addMessage(bookingId, payload.new as Message);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, addMessage]);

  // Realtime fallback. The Supabase postgres_changes channel above is
  // the primary push path, but it depends on the realtime publication
  // delivering rows under RLS — if the mobile client doesn't carry a
  // Supabase JWT (we authenticate via Laravel Sanctum), the SELECT
  // policy on `messages` blocks the subscription and pushes silently
  // never arrive. Polling closes that gap. While the screen is in the
  // foreground we tail the conversation every 2s; when the app is
  // backgrounded we stop entirely and refetch once on resume so we
  // don't burn battery or rate-limit while the user is elsewhere.
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        // Bypass the GET micro-cache — the whole point of this tick is
        // to discover messages we don't yet have. Without `noCache` the
        // 10s response cache on `getMessages` would short-circuit every
        // poll for up to 10 seconds, so receivers could wait that long
        // to see a freshly-sent message (and its image).
        const response = await chatService.getMessages(bookingId, { limit: 50, noCache: true } as any);
        if (cancelled) return;
        const fresh: Message[] = response.data?.data ?? [];
        if (fresh.length === 0) return;
        const existing = useChatStore.getState().messages[bookingId] ?? [];
        const ids = new Set(existing.map((m) => m.id));
        for (const m of fresh) {
          if (!ids.has(m.id)) addMessage(bookingId, m);
        }
      } catch {
        /* ignore — next tick will retry */
      }
    };

    const start = () => {
      if (intervalId) return;
      // Tick immediately so resume-from-background doesn't wait 2s for
      // the next interval edge to surface anything new.
      tick();
      intervalId = setInterval(tick, 2_000);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    if (AppState.currentState === 'active') start();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, [bookingId, addMessage]);

  // Persist the live store to disk whenever the message list changes.
  // Throttled by trailing-edge effect debounce: we only write when the
  // length stops changing for ~600ms so a burst of incoming pushes
  // collapses into a single AsyncStorage write.
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
    }, 600);
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
  };
}
