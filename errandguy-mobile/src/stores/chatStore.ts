import { create } from 'zustand';
import type { Message } from '../types';
import { chatService } from '../services/chat.service';

interface ChatState {
  messages: Record<string, Message[]>;
  unreadCount: number;
  /** Per-booking unread count (server source of truth, refreshed
   *  periodically and after navigating away from a chat). */
  unreadByBooking: Record<string, number>;
  isTyping: boolean;

  addMessage: (bookingId: string, message: Message) => void;
  /** Swap a placeholder message (matched by id) for the server
   *  copy. Used by the optimistic send path so the bubble appears
   *  instantly and is rewritten when the API responds. */
  replaceMessage: (bookingId: string, tempId: string, message: Message) => void;
  /** Remove a placeholder message (matched by id). Used to roll back
   *  an optimistic send when the network call fails. */
  removeMessage: (bookingId: string, messageId: string) => void;
  setMessages: (bookingId: string, messages: Message[]) => void;
  markRead: (bookingId: string) => void;
  clearChat: (bookingId: string) => void;
  setUnreadCount: (count: number) => void;
  setIsTyping: (typing: boolean) => void;
  refreshUnread: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  unreadCount: 0,
  unreadByBooking: {},
  isTyping: false,

  addMessage: (bookingId, message) =>
    set((state) => {
      const existing = state.messages[bookingId] || [];
      // Dedupe: Realtime fan-out re-delivers the message we just
      // optimistically appended after sending, so without this guard the
      // sender would see their own message twice. Match by id (UUID).
      if (message?.id && existing.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messages: {
          ...state.messages,
          [bookingId]: [...existing, message],
        },
      };
    }),

  setMessages: (bookingId, messages) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [bookingId]: messages,
      },
    })),

  replaceMessage: (bookingId, tempId, message) =>
    set((state) => {
      const list = state.messages[bookingId] || [];
      // If the real message already arrived (e.g. via Realtime push
      // before our HTTP response), drop the temp instead of duplicating.
      const realAlready = message?.id && list.some((m) => m.id === message.id);
      const next = list
        .filter((m) => m.id !== tempId)
        .concat(realAlready ? [] : [message]);
      return {
        messages: { ...state.messages, [bookingId]: next },
      };
    }),

  removeMessage: (bookingId, messageId) =>
    set((state) => {
      const list = state.messages[bookingId] || [];
      return {
        messages: {
          ...state.messages,
          [bookingId]: list.filter((m) => m.id !== messageId),
        },
      };
    }),

  markRead: (bookingId) => {
    const msgs = get().messages[bookingId];
    if (msgs) {
      set((state) => ({
        messages: {
          ...state.messages,
          [bookingId]: msgs.map((m) => ({
            ...m,
            read_at: m.read_at || new Date().toISOString(),
          })),
        },
      }));
    }
    // Optimistically zero the unread count for this booking and adjust total.
    set((state) => {
      const prev = state.unreadByBooking[bookingId] ?? 0;
      if (prev === 0) return state;
      const { [bookingId]: _, ...rest } = state.unreadByBooking;
      return {
        unreadByBooking: rest,
        unreadCount: Math.max(0, state.unreadCount - prev),
      };
    });
  },

  clearChat: (bookingId) =>
    set((state) => {
      const { [bookingId]: _, ...rest } = state.messages;
      return { messages: rest };
    }),

  setUnreadCount: (count) => set({ unreadCount: count }),

  setIsTyping: (typing) => set({ isTyping: typing }),

  refreshUnread: async () => {
    try {
      const res = await chatService.getUnreadCount();
      const data = res.data?.data;
      if (!data) return;
      set({
        unreadCount: data.total ?? 0,
        unreadByBooking:
          (data.by_booking as Record<string, number>) ?? {},
      });
    } catch {
      // Silently ignore — UI will retry on next interval.
    }
  },
}));
