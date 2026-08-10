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
});
