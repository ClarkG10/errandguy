/**
 * The chat unread badge, driven by Reverb instead of by the clock.
 *
 * A message already arrives over `chat.{bookingId}`, but the only subscriber
 * was the chat screen itself — so on the tracking screen and the runner
 * cockpit, where "which gate?" is time-critical, the badge was a 30s poll of
 * /chat/unread-count. useRealtimeNotifications (mounted app-wide for the
 * notification stream) now also watches the user's open conversations and
 * counts incoming messages into chatStore; the poll stays as the reconcile.
 *
 * What these tests pin is the pair of things that make that safe:
 *   • the optimistic count never double-counts (own echo, re-delivery, an
 *     already-read message), and
 *   • the server stays authoritative — EXCEPT for a message that landed while
 *     its request was in flight, which no snapshot could have contained.
 *
 * It lives under services/__tests__ (rather than stores/ or hooks/) because
 * this workstream owns that directory; the subject is the store + the hook.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useChatStore, __resetChatRealtimeBookkeeping } from '../../stores/chatStore';
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications';
import type { Message } from '../../types';

// ── Reverb: capture subscriptions instead of opening a socket ─────────────
type Handler = (payload: unknown) => void;
const mockListeners = new Map<string, Map<string, Set<Handler>>>();
const mockRetained: string[] = [];
const mockReleased: string[] = [];

jest.mock('../../services/echo', () => ({
  echo: {
    private: (name: string) => ({
      listen: (event: string, handler: Handler) => {
        const byEvent = mockListeners.get(name) ?? new Map<string, Set<Handler>>();
        const set = byEvent.get(event) ?? new Set<Handler>();
        set.add(handler);
        byEvent.set(event, set);
        mockListeners.set(name, byEvent);
      },
      stopListening: (event: string, handler: Handler) => {
        mockListeners.get(name)?.get(event)?.delete(handler);
      },
    }),
  },
  retainChannel: (name: string) => mockRetained.push(name),
  releaseChannel: (name: string) => mockReleased.push(name),
}));

// ── The notification channel itself is not under test here ────────────────
jest.mock('../../hooks/useEchoChannel', () => ({
  useEchoChannel: (opts: { onEvent: (p: unknown) => void }) => {
    mockNotificationEvent.push(opts.onEvent);
    return { isConnected: true };
  },
}));
const mockNotificationEvent: Array<(p: unknown) => void> = [];

// ── The watch-set resolver runs on a smart-polling tick; drive it by hand ──
const mockPollers: Array<{ cb: () => void | Promise<unknown>; opts: { enabled?: boolean } }> = [];
jest.mock('../../hooks/useSmartPolling', () => ({
  useSmartPolling: (cb: () => void | Promise<unknown>, opts: { enabled?: boolean }) => {
    mockPollers.push({ cb, opts });
  },
}));

jest.mock('../../hooks/useQuery', () => ({ invalidateQuery: jest.fn(() => Promise.resolve()) }));

const mockGetConversations = jest.fn();
const mockGetUnreadCount = jest.fn();
jest.mock('../chat.service', () => ({
  chatService: {
    getConversations: (...a: unknown[]) => mockGetConversations(...a),
    getUnreadCount: (...a: unknown[]) => mockGetUnreadCount(...a),
  },
}));
jest.mock('../notification.service', () => ({
  notificationService: {
    getUnreadCount: jest.fn(() => Promise.resolve({ data: { data: { unread_count: 0 } } })),
  },
}));

const ME = 'user-1';
const OTHER = 'user-2';
const B = 'booking-1';

const message = (id: string, senderId = OTHER, extra: Partial<Message> = {}): Message =>
  ({
    id,
    booking_id: B,
    sender_id: senderId,
    content: 'which gate?',
    image_url: null,
    is_system: false,
    read_at: null,
    created_at: '2026-08-29T10:00:00Z',
    ...extra,
  }) as Message;

const conversation = (bookingId: string, status = 'in_transit', counterparty = true) => ({
  booking_id: bookingId,
  booking_number: 'EG-1',
  status,
  errand_type: null,
  counterparty: counterparty ? { id: OTHER, full_name: 'Ana', avatar_url: null } : null,
  last_message: null,
  unread_count: 0,
});

const deliver = (bookingId: string, payload: Message) => {
  mockListeners.get(`chat.${bookingId}`)?.get('.message.created')?.forEach((h) => h(payload));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  mockRetained.length = 0;
  mockReleased.length = 0;
  mockNotificationEvent.length = 0;
  mockPollers.length = 0;
  __resetChatRealtimeBookkeeping();
  useChatStore.setState({ messages: {}, unreadCount: 0, unreadByBooking: {}, typingByBooking: {} });
  mockGetConversations.mockResolvedValue({ data: { data: [conversation(B)] } });
  mockGetUnreadCount.mockResolvedValue({ data: { data: { total: 0, by_booking: {} } } });
});

describe('chatStore.noteIncomingMessage', () => {
  const note = (m: Message) => useChatStore.getState().noteIncomingMessage(B, m, ME);

  it('raises the per-booking badge and the total the moment a message lands', () => {
    note(message('m1'));

    expect(useChatStore.getState().unreadByBooking[B]).toBe(1);
    expect(useChatStore.getState().unreadCount).toBe(1);
  });

  it('ignores our own message echoed back off the shared channel', () => {
    note(message('m1', ME));

    expect(useChatStore.getState().unreadByBooking[B]).toBeUndefined();
    expect(useChatStore.getState().unreadCount).toBe(0);
  });

  it('ignores a message the server already considers read', () => {
    note(message('m1', OTHER, { read_at: '2026-08-29T10:00:01Z' }));

    expect(useChatStore.getState().unreadCount).toBe(0);
  });

  it('counts a re-delivered message exactly once', () => {
    // A socket drop re-subscribes and replays; the cockpit also shares the
    // channel with an open thread. Neither may inflate the badge.
    note(message('m1'));
    note(message('m1'));

    expect(useChatStore.getState().unreadByBooking[B]).toBe(1);
    expect(useChatStore.getState().unreadCount).toBe(1);
  });

  it('is cleared by opening the thread', () => {
    note(message('m1'));
    useChatStore.getState().markRead(B, ME);

    expect(useChatStore.getState().unreadByBooking[B]).toBeUndefined();
    expect(useChatStore.getState().unreadCount).toBe(0);
  });
});

describe('chatStore.refreshUnread — the poll is still the authority', () => {
  it('overwrites an optimistic count with the server snapshot', async () => {
    useChatStore.getState().noteIncomingMessage(B, message('m1'), ME);
    // e.g. the user read it on another device.
    mockGetUnreadCount.mockResolvedValue({ data: { data: { total: 0, by_booking: {} } } });

    await useChatStore.getState().refreshUnread();

    expect(useChatStore.getState().unreadByBooking[B]).toBeUndefined();
    expect(useChatStore.getState().unreadCount).toBe(0);
  });

  it('keeps a message that arrived WHILE the request was in flight', async () => {
    let release: (value: unknown) => void = () => {};
    mockGetUnreadCount.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const pending = useChatStore.getState().refreshUnread();
    // Lands after the request was sent, so the snapshot cannot contain it.
    useChatStore.getState().noteIncomingMessage(B, message('m1'), ME);
    release({ data: { data: { total: 0, by_booking: {} } } });
    await pending;

    // Blindly trusting the stale snapshot would blink the badge off for 30s.
    expect(useChatStore.getState().unreadByBooking[B]).toBe(1);
    expect(useChatStore.getState().unreadCount).toBe(1);
  });

  it('does not let a stale in-flight bump survive the NEXT reconcile', async () => {
    let release: (value: unknown) => void = () => {};
    mockGetUnreadCount.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = useChatStore.getState().refreshUnread();
    useChatStore.getState().noteIncomingMessage(B, message('m1'), ME);
    release({ data: { data: { total: 0, by_booking: {} } } });
    await pending;

    mockGetUnreadCount.mockResolvedValue({ data: { data: { total: 0, by_booking: {} } } });
    await useChatStore.getState().refreshUnread();

    expect(useChatStore.getState().unreadCount).toBe(0);
  });
});

describe('useRealtimeNotifications — the app-wide chat watcher', () => {
  const mount = async () => {
    const view = renderHook(() => useRealtimeNotifications(ME));
    // The watch set is derived on the polling tick (mount / foreground /
    // reconnect in the real hook).
    await act(async () => {
      await mockPollers[0]?.cb();
    });
    return view;
  };

  it('subscribes to the chat channel of every open conversation', async () => {
    await mount();

    expect(mockRetained).toEqual([`chat.${B}`]);
    expect(mockListeners.get(`chat.${B}`)?.get('.message.created')?.size).toBe(1);
  });

  it('raises the badge the instant the message arrives — no poll', async () => {
    await mount();

    act(() => deliver(B, message('m1')));

    expect(useChatStore.getState().unreadByBooking[B]).toBe(1);
    expect(mockGetUnreadCount).not.toHaveBeenCalled();
  });

  it('does not raise it for the message this user just sent', async () => {
    await mount();

    act(() => deliver(B, message('m1', ME)));

    expect(useChatStore.getState().unreadCount).toBe(0);
  });

  it('skips threads nobody can message: closed bookings and unassigned ones', async () => {
    mockGetConversations.mockResolvedValue({
      data: {
        data: [
          conversation('done-1', 'completed'),
          conversation('unassigned-1', 'pending', false),
        ],
      },
    });

    await mount();

    expect(mockRetained).toEqual([]);
  });

  it('caps the number of watched conversations', async () => {
    mockGetConversations.mockResolvedValue({
      data: { data: ['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => conversation(id)) },
    });

    await mount();

    expect(mockRetained).toEqual(['chat.b1', 'chat.b2', 'chat.b3']);
  });

  it('releases every channel on unmount, leaving co-subscribers alone', async () => {
    const view = await mount();

    view.unmount();

    expect(mockReleased).toEqual([`chat.${B}`]);
    // The listener was removed by identity, not by clearing the event.
    expect(mockListeners.get(`chat.${B}`)?.get('.message.created')?.size).toBe(0);
  });

  it('re-derives the watch set when a notification names an unwatched booking', async () => {
    await mount();
    expect(mockGetConversations).toHaveBeenCalledTimes(1);

    mockGetConversations.mockResolvedValue({
      data: { data: [conversation(B), conversation('booking-2')] },
    });
    await act(async () => {
      mockNotificationEvent.forEach((fire) =>
        fire({ id: 'n1', type: 'booking_update', data: { booking_id: 'booking-2' } }),
      );
      await Promise.resolve();
    });

    expect(mockGetConversations).toHaveBeenCalledTimes(2);
    expect(mockRetained).toContain('chat.booking-2');
  });

  it('starts watching a thread the reconcile poll reports unread on', async () => {
    // No notification announces the runner's OWN accept, so this is how their
    // cockpit picks the thread up: the 30s poll names a booking we're blind to.
    mockGetConversations.mockResolvedValue({ data: { data: [] } });
    await mount();
    expect(mockRetained).toEqual([]);

    mockGetConversations.mockResolvedValue({ data: { data: [conversation('booking-9')] } });
    await act(async () => {
      useChatStore.setState({ unreadByBooking: { 'booking-9': 1 }, unreadCount: 1 });
      await Promise.resolve();
    });

    expect(mockRetained).toEqual(['chat.booking-9']);
  });

  it('does not re-derive for a booking it is already watching', async () => {
    await mount();

    act(() => {
      mockNotificationEvent.forEach((fire) =>
        fire({ id: 'n1', type: 'booking_update', data: { booking_id: B } }),
      );
    });

    expect(mockGetConversations).toHaveBeenCalledTimes(1);
  });
});
