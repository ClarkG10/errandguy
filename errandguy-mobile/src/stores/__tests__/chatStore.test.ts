import { act } from '@testing-library/react-native';
import { useChatStore } from '../chatStore';
import type { Message } from '../../types';

const B = 'booking-1';

function msg(id: string, createdAt: string, over: Partial<Message> = {}): Message {
  return {
    id,
    booking_id: B,
    sender_id: 'other',
    content: 'hi',
    image_url: null,
    is_system: false,
    read_at: null,
    created_at: createdAt,
    ...over,
  };
}

const ids = (bookingId = B) =>
  (useChatStore.getState().messages[bookingId] ?? []).map((m) => m.id);

beforeEach(() => {
  useChatStore.setState({
    messages: {},
    unreadCount: 0,
    unreadByBooking: {},
    typingByBooking: {},
  });
});

describe('chatStore.addMessage ordering (RT-5)', () => {
  it('keeps messages chronological even when they arrive out of order', () => {
    act(() => {
      // Arrive newest-first (as a late poll batch or reordered push might).
      useChatStore.getState().addMessage(B, msg('c', '2026-08-11T10:00:03Z'));
      useChatStore.getState().addMessage(B, msg('a', '2026-08-11T10:00:01Z'));
      useChatStore.getState().addMessage(B, msg('b', '2026-08-11T10:00:02Z'));
    });
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('dedupes by id (realtime re-delivery of an already-held message)', () => {
    act(() => {
      useChatStore.getState().addMessage(B, msg('a', '2026-08-11T10:00:01Z'));
      useChatStore.getState().addMessage(B, msg('a', '2026-08-11T10:00:01Z'));
    });
    expect(ids()).toEqual(['a']);
  });

  it('breaks created_at ties deterministically by id', () => {
    const t = '2026-08-11T10:00:00Z';
    act(() => {
      useChatStore.getState().addMessage(B, msg('z', t));
      useChatStore.getState().addMessage(B, msg('m', t));
      useChatStore.getState().addMessage(B, msg('a', t));
    });
    expect(ids()).toEqual(['a', 'm', 'z']);
  });
});

describe('chatStore.replaceMessage ordering (RT-5)', () => {
  it('swaps the optimistic placeholder for the server copy and re-sorts', () => {
    act(() => {
      useChatStore.getState().addMessage(B, msg('a', '2026-08-11T10:00:01Z'));
      // Optimistic send: client-clock timestamp puts it at the tail.
      useChatStore
        .getState()
        .addMessage(B, msg('tmp-1', '2026-08-11T10:00:05Z', { sender_id: 'me' }));
      // Server confirms with the canonical id and its true (earlier) time.
      useChatStore
        .getState()
        .replaceMessage(B, 'tmp-1', msg('real-1', '2026-08-11T10:00:02Z', { sender_id: 'me' }));
    });
    expect(ids()).toEqual(['a', 'real-1']);
    expect(ids()).not.toContain('tmp-1');
  });

  it('keeps a failed placeholder (id === tempId) so the retry bubble renders', () => {
    // Send-failure path: useChat re-uses the tempId as the message id and flags
    // it failed. The dedupe guard must NOT treat that as an already-arrived
    // canonical message, else the bubble is filtered out and the send vanishes.
    act(() => {
      useChatStore
        .getState()
        .addMessage(B, msg('tmp-1', '2026-08-11T10:00:05Z', { sender_id: 'me', pending: true }));
      useChatStore.getState().replaceMessage(B, 'tmp-1', {
        ...msg('tmp-1', '2026-08-11T10:00:05Z', { sender_id: 'me' }),
        pending: false,
        failed: true,
      });
    });
    expect(ids()).toEqual(['tmp-1']);
    const failed = useChatStore.getState().messages[B]?.[0];
    expect(failed?.failed).toBe(true);
    expect(failed?.pending).toBe(false);
  });

  it('still dedupes when the real message arrived before the HTTP response', () => {
    // Realtime pushed the canonical copy first; the optimistic replace must
    // drop the temp and NOT duplicate the already-present real message.
    act(() => {
      useChatStore
        .getState()
        .addMessage(B, msg('tmp-2', '2026-08-11T10:00:05Z', { sender_id: 'me' }));
      useChatStore
        .getState()
        .addMessage(B, msg('real-2', '2026-08-11T10:00:05Z', { sender_id: 'me' }));
      useChatStore
        .getState()
        .replaceMessage(B, 'tmp-2', msg('real-2', '2026-08-11T10:00:05Z', { sender_id: 'me' }));
    });
    expect(ids()).toEqual(['real-2']);
  });
});
