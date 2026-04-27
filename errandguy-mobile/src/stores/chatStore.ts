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
    set((state) => ({
      messages: {
        ...state.messages,
        [bookingId]: [...(state.messages[bookingId] || []), message],
      },
    })),

  setMessages: (bookingId, messages) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [bookingId]: messages,
      },
    })),

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
