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

/**
 * A message as the store keeps it: always with a usable `created_at`.
 *
 * The send endpoint used to answer without `created_at` (a DB-defaulted
 * column the model never read back), and the realtime copy could miss it too.
 * A bubble without a timestamp rendered "Invalid Date", sorted by id into a
 * random slot, and opened an extra day divider of its own. The server's own
 * value always wins; `fallback` (the optimistic bubble's local send time, or
 * "now" for an arrival) only fills a missing or unparseable one.
 */
export function withTimestamp(message: Message, fallback: string): Message {
  if (typeof message?.created_at === 'string' && Number.isFinite(Date.parse(message.created_at))) {
    return message;
  }
  return { ...message, created_at: fallback };
}

/**
 * The optimistic bubble a server copy stands for: our own still-pending `tmp-`
 * send with the same text and the same photo-or-not. Lets the realtime echo
 * (or a poll) that beats the HTTP response REPLACE the placeholder instead of
 * sitting next to it as a duplicate.
 */
function pendingTwinIndex(list: Message[], message: Message): number {
  return list.findIndex(
    (m) =>
      m.pending === true &&
      m.id.startsWith('tmp-') &&
      m.sender_id === message.sender_id &&
      (m.content ?? '') === (message.content ?? '') &&
      !!m.image_url === !!message.image_url,
  );
}

/**
 * Message ids already counted into `unreadByBooking` by the realtime path.
 *
 * The same message can reach us twice — a re-subscribe after a socket drop
 * re-delivers, and the cockpit's chat channel is shared with the open thread —
 * and an unread badge that double-counts is worse than one that waits. Bounded
 * so a long shift can't grow it without limit; the poll is the reconcile, so
 * forgetting an old id is harmless.
 */
const COUNTED_IDS_LIMIT = 300;
const countedMessageIds = new Set<string>();

/**
 * bookingId → the sequence number of the last realtime increment on its badge.
 * Read by refreshUnread to decide whether the server snapshot it just received
 * is actually OLDER than what we know (see the merge there).
 *
 * A monotonic counter, not a timestamp: Date.now() has millisecond resolution,
 * and a message can land in the same millisecond a reconcile was issued —
 * exactly the case this ordering has to get right.
 */
let unreadBumpSeq = 0;
const lastBumpSeqByBooking = new Map<string, number>();

function rememberCounted(messageId: string): void {
  if (countedMessageIds.size >= COUNTED_IDS_LIMIT) {
    // Cheapest possible bound: drop the oldest insertion (Sets iterate in
    // insertion order). One eviction per add once the cap is reached.
    const oldest = countedMessageIds.values().next().value;
    if (oldest !== undefined) countedMessageIds.delete(oldest);
  }
  countedMessageIds.add(messageId);
}

/** Test seam — the module keeps realtime bookkeeping outside the store state
 *  so it never triggers a re-render. */
export function __resetChatRealtimeBookkeeping(): void {
  countedMessageIds.clear();
  lastBumpSeqByBooking.clear();
  unreadBumpSeq = 0;
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
  /**
   * The conversation on screen right now (a chat screen in focus), or null.
   * The foreground push handler stays quiet for this thread's chat pushes —
   * the message is already appearing in front of the person.
   */
  openThreadId: string | null;

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
  /**
   * Count a chat message that arrived over Reverb into the per-booking unread
   * badge. Called by the app-wide chat watcher (useRealtimeNotifications) for
   * conversations the user is NOT currently reading, so the badge on the
   * tracking / cockpit screens appears the moment the message lands instead of
   * waiting out the 30s reconcile poll. Idempotent per message id.
   */
  noteIncomingMessage: (bookingId: string, message: Message, myId?: string | null) => void;
  refreshUnread: () => Promise<void>;
  /** Mark a thread as on screen (null = none). */
  setOpenThread: (bookingId: string | null) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  unreadCount: 0,
  unreadByBooking: {},
  typingByBooking: {},
  openThreadId: null,

  addMessage: (bookingId, message) =>
    set((state) => {
      const existing = state.messages[bookingId] || [];
      // Dedupe by id: a re-delivery after a socket drop, or the poll and the
      // channel both carrying the same row.
      if (message?.id && existing.some((m) => m.id === message.id)) {
        return state;
      }
      // Our own send echoed back BEFORE the HTTP response landed: swap the
      // optimistic bubble for the server copy (keeping its send time if the
      // copy has none) rather than showing the message twice.
      const twin = message?.id && !message.id.startsWith('tmp-') ? pendingTwinIndex(existing, message) : -1;
      const base = twin === -1 ? existing : existing.filter((_, i) => i !== twin);
      const fallback = twin === -1 ? new Date().toISOString() : existing[twin].created_at;
      return {
        messages: {
          ...state.messages,
          [bookingId]: [...base, withTimestamp(message, fallback)].sort(compareMessages),
        },
      };
    }),

  setMessages: (bookingId, messages) =>
    set((state) => {
      const now = new Date().toISOString();
      return {
        messages: {
          ...state.messages,
          [bookingId]: messages.map((m) => withTimestamp(m, now)),
        },
      };
    }),

  replaceMessage: (bookingId, tempId, message) =>
    set((state) => {
      const list = state.messages[bookingId] || [];
      const placeholder = list.find((m) => m.id === tempId);
      // The placeholder is already gone: the realtime echo of this very send
      // replaced it (addMessage above). A failure arriving now — a timeout
      // after the server saved the message — must not resurrect a "failed"
      // bubble for a message that was delivered.
      if (!placeholder && message?.id === tempId) return state;
      // If the real message already arrived (e.g. via Realtime push
      // before our HTTP response), drop the temp instead of duplicating.
      // Exclude tempId itself: the send-failure path calls replaceMessage
      // with a placeholder whose id IS the tempId (to convert it into a
      // "failed · tap to retry" bubble). Without this guard that placeholder
      // matched itself in the list, realAlready became true, and the failed
      // bubble was filtered out and never re-added — the message vanished.
      const realAlready =
        message?.id && message.id !== tempId && list.some((m) => m.id === message.id);
      const next = list
        .filter((m) => m.id !== tempId)
        // The server copy keeps its own created_at; only a missing one falls
        // back to the bubble's local send time (never "Invalid Date").
        .concat(
          realAlready
            ? []
            : [withTimestamp(message, placeholder?.created_at ?? new Date().toISOString())],
        )
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
    // The thread is open: whatever the realtime path counted for it is now
    // read, so drop the bump marker too — otherwise refreshUnread's merge
    // below could re-raise the badge the user just cleared.
    lastBumpSeqByBooking.delete(bookingId);

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

  noteIncomingMessage: (bookingId, message, myId) => {
    if (!bookingId || !message?.id) return;
    // Our own message echoed back off the channel — the sender never has an
    // unread badge for what they just typed.
    if (myId && message.sender_id === myId) return;
    // Mirror the server's predicate exactly (ChatController::unreadCount counts
    // messages from the other participant with a null read_at), so the
    // optimistic value and the reconcile can only ever agree.
    if (message.read_at) return;
    if (countedMessageIds.has(message.id)) return;
    rememberCounted(message.id);
    lastBumpSeqByBooking.set(bookingId, ++unreadBumpSeq);
    set((state) => ({
      unreadByBooking: {
        ...state.unreadByBooking,
        [bookingId]: (state.unreadByBooking[bookingId] ?? 0) + 1,
      },
      unreadCount: state.unreadCount + 1,
    }));
  },

  setOpenThread: (bookingId) => {
    if (get().openThreadId === bookingId) return;
    set({ openThreadId: bookingId });
  },

  refreshUnread: async () => {
    // Read BEFORE the request so we can tell a realtime message that landed
    // while it was in flight from one the server already knew about.
    const seqAtStart = unreadBumpSeq;
    try {
      const res = await chatService.getUnreadCount();
      const data = res.data?.data;
      if (!data) return;
      const byBooking = (data.by_booking as Record<string, number>) ?? {};
      set((state) => {
        // The server is authoritative — it is what clears a badge read on
        // another device. The ONE exception: a message that arrived over
        // Reverb AFTER this request was sent cannot be in the snapshot it
        // answers with, and blindly overwriting would blink the badge back off
        // for up to 30s. Keep the larger value for those bookings only.
        const merged: Record<string, number> = { ...byBooking };
        let total = data.total ?? 0;
        for (const [bookingId, seq] of lastBumpSeqByBooking) {
          if (seq <= seqAtStart) continue;
          const local = state.unreadByBooking[bookingId] ?? 0;
          const fromServer = merged[bookingId] ?? 0;
          if (local > fromServer) {
            total += local - fromServer;
            merged[bookingId] = local;
          }
        }
        return { unreadCount: total, unreadByBooking: merged };
      });
      // Bumps older than this snapshot are now folded into it.
      for (const [bookingId, seq] of [...lastBumpSeqByBooking]) {
        if (seq <= seqAtStart) lastBumpSeqByBooking.delete(bookingId);
      }
    } catch {
      // Silently ignore — UI will retry on next interval.
    }
  },
}));
