import { useEffect, useCallback, useState, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { chatService } from '../services/chat.service';
import { supabase } from '../services/supabase';
import type { Message } from '../types';

export function useChat(bookingId: string) {
  const { messages, unreadCount, isTyping, addMessage, setMessages, markRead, setIsTyping } =
    useChatStore();

  const bookingMessages = messages[bookingId] || [];

  // Cursor + has-more tracker for infinite-scroll-back. Reset whenever
  // the bookingId switches so a new conversation starts at the head.
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursorRef = useRef<string | null>(null);

  const fetchMessages = useCallback(async () => {
    const response = await chatService.getMessages(bookingId, { limit: 50 });
    const data = response.data?.data ?? [];
    const meta = response.data?.meta ?? {};
    setMessages(bookingId, data);
    setHasMore(!!meta.has_more);
    cursorRef.current = meta.next_before ?? null;
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
      const response = await chatService.sendMessage(bookingId, {
        content,
        image_url,
      });
      addMessage(bookingId, response.data.data);
    },
    [bookingId, addMessage],
  );

  /**
   * Send a message with an inline image. The local file URI is uploaded
   * via multipart, the server returns the persisted message including
   * the canonical CDN url. We add it to the local store so the sender
   * sees it immediately even if Realtime takes a moment to fan out.
   */
  const sendMessageWithImage = useCallback(
    async (imageUri: string, content?: string) => {
      const response = await chatService.sendMessageWithImage(bookingId, {
        imageUri,
        content,
      });
      addMessage(bookingId, response.data.data);
    },
    [bookingId, addMessage],
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

  // Polling fallback for new messages. Realtime above is the primary
  // path but it can drop silently (cellular handoff, RLS misconfig,
  // table not in publication). Re-fetching the head every 6s while
  // the screen is mounted means a dropped websocket adds at most ~6s
  // of latency instead of stalling the conversation forever. We dedup
  // by id and only `addMessage` for ids the store hasn't seen, so
  // pagination state and the user's scroll position are untouched.
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await chatService.getMessages(bookingId, { limit: 50 });
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
    const id = setInterval(tick, 6_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bookingId, addMessage]);

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
    markAsRead,
    setIsTyping,
  };
}
