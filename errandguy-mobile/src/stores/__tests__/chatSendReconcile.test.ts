import { act } from '@testing-library/react-native';
import { useChatStore, withTimestamp } from '../chatStore';
import type { Message } from '../../types';

/**
 * The bubble a sender sees for their own message:
 *   • never "Invalid Date" — the send response used to carry no created_at;
 *   • one bubble, not two — the realtime echo can beat the HTTP response;
 *   • never "failed" for a message the server actually saved.
 */
const B = 'booking-1';
const ME = 'me';

const message = (over: Partial<Message>): Message => ({
  id: 'm',
  booking_id: B,
  sender_id: ME,
  content: 'On my way',
  image_url: null,
  is_system: false,
  read_at: null,
  created_at: '2026-10-31T01:00:00Z',
  ...over,
});

const placeholder = (id = 'tmp-1', over: Partial<Message> = {}) =>
  message({ id, pending: true, created_at: '2026-10-31T01:00:05.000Z', ...over });

const list = () => useChatStore.getState().messages[B] ?? [];

beforeEach(() => {
  useChatStore.setState({ messages: {}, unreadCount: 0, unreadByBooking: {}, typingByBooking: {}, openThreadId: null });
});

describe('server copy replaces the optimistic bubble', () => {
  it('keeps the local send time when the server copy has no created_at', () => {
    act(() => {
      useChatStore.getState().addMessage(B, placeholder());
      useChatStore.getState().replaceMessage(B, 'tmp-1', message({ id: 'srv-1', created_at: null as any }));
    });
    expect(list()).toHaveLength(1);
    expect(list()[0].id).toBe('srv-1');
    expect(list()[0].created_at).toBe('2026-10-31T01:00:05.000Z');
  });

  it("prefers the server's own created_at when it sends one", () => {
    act(() => {
      useChatStore.getState().addMessage(B, placeholder());
      useChatStore.getState().replaceMessage(B, 'tmp-1', message({ id: 'srv-1', created_at: '2026-10-31T01:00:06Z' }));
    });
    expect(list()[0].created_at).toBe('2026-10-31T01:00:06Z');
  });

  it('a realtime echo that beats the HTTP response replaces the bubble — no duplicate', () => {
    act(() => {
      useChatStore.getState().addMessage(B, placeholder());
      // Echo over the channel first (no created_at, as the broadcast had none)…
      useChatStore.getState().addMessage(B, message({ id: 'srv-1', created_at: undefined as any }));
    });
    expect(list().map((m) => m.id)).toEqual(['srv-1']);
    expect(list()[0].created_at).toBe('2026-10-31T01:00:05.000Z');

    // …then the HTTP response for the same send.
    act(() => {
      useChatStore.getState().replaceMessage(B, 'tmp-1', message({ id: 'srv-1' }));
    });
    expect(list().map((m) => m.id)).toEqual(['srv-1']);
  });

  it('a failure arriving after the echo delivered the message does not resurrect a failed bubble', () => {
    const tmp = placeholder();
    act(() => {
      useChatStore.getState().addMessage(B, tmp);
      useChatStore.getState().addMessage(B, message({ id: 'srv-1' }));
      useChatStore.getState().replaceMessage(B, 'tmp-1', { ...tmp, pending: false, failed: true });
    });
    expect(list().map((m) => m.id)).toEqual(['srv-1']);
  });

  it('a genuine failure still leaves a tappable failed bubble', () => {
    const tmp = placeholder();
    act(() => {
      useChatStore.getState().addMessage(B, tmp);
      useChatStore.getState().replaceMessage(B, 'tmp-1', { ...tmp, pending: false, failed: true });
    });
    expect(list()).toHaveLength(1);
    expect(list()[0].failed).toBe(true);
  });

  it("an echo only replaces OUR pending bubble with the same text — not someone else's message", () => {
    act(() => {
      useChatStore.getState().addMessage(B, placeholder());
      useChatStore.getState().addMessage(B, message({ id: 'srv-2', sender_id: 'runner', content: 'On my way' }));
      useChatStore.getState().addMessage(B, message({ id: 'srv-3', content: 'Different text' }));
    });
    expect(list().map((m) => m.id).sort()).toEqual(['srv-2', 'srv-3', 'tmp-1']);
  });

  it('an incoming message without a timestamp is stamped on arrival, never left undated', () => {
    act(() => {
      useChatStore.getState().addMessage(B, message({ id: 'in-1', sender_id: 'runner', created_at: null as any }));
    });
    expect(Number.isFinite(Date.parse(list()[0].created_at))).toBe(true);
  });

  it('withTimestamp leaves a valid timestamp alone and fills a bad one', () => {
    const ok = message({ created_at: '2026-10-31T01:00:00Z' });
    expect(withTimestamp(ok, 'x')).toBe(ok);
    expect(withTimestamp(message({ created_at: 'garbage' }), '2026-01-01T00:00:00Z').created_at).toBe(
      '2026-01-01T00:00:00Z',
    );
  });
});

describe('the thread on screen', () => {
  it('is recorded and cleared', () => {
    useChatStore.getState().setOpenThread(B);
    expect(useChatStore.getState().openThreadId).toBe(B);
    useChatStore.getState().setOpenThread(null);
    expect(useChatStore.getState().openThreadId).toBeNull();
  });
});
