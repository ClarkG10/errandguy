import { create } from 'zustand';
import type { Message } from '../types';
import { chatService } from '../services/chat.service';

/**
 * Chronological order key: (created_at, id) ascending — the same order the
 * server sorts by. Messages can land out of arrival-order (a poll batch, or a
 * realtime push that arrives after our own optimistic send), so the store
 * re-sorts on every add/merge rather than trusting append order. Ties (equal
 * created_at) break on id so the order is stable and deterministic. (RT-5)
 */
function compareMessages(a: Message, b: Message): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface ChatState {
  messages: Record<string, Message[]>;
  unreadCount: number;
  /** Per-booking unread count (server source of truth, refreshed
   *  periodically and after navigating away from a chat). */
  unreadByBooking: Record<string, number>;
  /** Per-booking "other participant is typing" flag. Keyed by bookingId
   *  so a typing event on one conversation can never light the indicator
   *  on another thread that happens to be mounted at the same time. */
  typingByBooking: Record<string, boolean>;

  addMessage: (bookingId: string, message: Message) => void;
  /** Swap a placeholder message (matched by id) for the server
   *  copy. Used by the optimistic send path so the bubble appears
   *  instantly and is rewritten when the API responds. */
  replaceMessage: (bookingId: string, tempId: string, message: Message) => void;
  /** Remove a placeholder message (matched by id). Used to roll back
   *  an optimistic send when the network call fails. */
  removeMessage: (bookingId: string, messageId: string) => void;
  setMessages: (bookingId: string, messages: Message[]) => void;
  markRead: (bookingId: string, myId?: string) => void;
  clearChat: (bookingId: string) => void;
  setUnreadCount: (count: number) => void;
  setIsTyping: (bookingId: string, typing: boolean) => void;
  refreshUnread: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  unreadCount: 0,
  unreadByBooking: {},
  typingByBooking: {},

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
          [bookingId]: [...existing, message].sort(compareMessages),
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
        .concat(realAlready ? [] : [message])
        // Re-sort on merge: the server copy's created_at may differ from the
        // optimistic placeholder's client clock, so its true chronological
        // slot can shift. (RT-5)
        .sort(compareMessages);
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

  markRead: (bookingId, myId) => {
    const msgs = get().messages[bookingId];
    if (msgs) {
      set((state) => ({
        messages: {
          ...state.messages,
          // Only stamp INCOMING messages as read — never the user's OWN outgoing
          // bubbles (that would fabricate a "Read" receipt for a message the
          // counterpart never opened). Incoming still gets stamped, so the unread
          // indicator clears correctly.
          [bookingId]: msgs.map((m) =>
            myId && m.sender_id === myId
              ? m
              : { ...m, read_at: m.read_at || new Date().toISOString() },
          ),
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

  setIsTyping: (bookingId, typing) =>
    set((state) => {
      if ((state.typingByBooking[bookingId] ?? false) === typing) return state;
      return {
        typingByBooking: { ...state.typingByBooking, [bookingId]: typing },
      };
    }),

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
