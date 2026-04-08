import { create } from 'zustand';
import type { Message } from '../types';

interface ChatState {
  messages: Record<string, Message[]>;
  unreadCount: number;
  isTyping: boolean;

  addMessage: (bookingId: string, message: Message) => void;
  setMessages: (bookingId: string, messages: Message[]) => void;
  markRead: (bookingId: string) => void;
  clearChat: (bookingId: string) => void;
  setUnreadCount: (count: number) => void;
  setIsTyping: (typing: boolean) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  unreadCount: 0,
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
  },

  clearChat: (bookingId) =>
    set((state) => {
      const { [bookingId]: _, ...rest } = state.messages;
      return { messages: rest };
    }),

  setUnreadCount: (count) => set({ unreadCount: count }),

  setIsTyping: (typing) => set({ isTyping: typing }),
}));
