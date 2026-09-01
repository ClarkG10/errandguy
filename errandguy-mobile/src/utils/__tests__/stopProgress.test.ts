import {
  stopCompletionsFromNotification,
  mergeStopCompletions,
  BOOKING_STOPS_UPDATED,
} from '../stopProgress';
import type { BookingStop } from '../../types/booking';

const stop = (id: string, completedAt: string | null = null): BookingStop => ({
  id,
  sequence: 1,
  address: `${id} street`,
  lat: 14.6,
  lng: 120.98,
  completed_at: completedAt,
});

const signal = (overrides: Record<string, unknown> = {}) => ({
  type: BOOKING_STOPS_UPDATED,
  data: {
    type: BOOKING_STOPS_UPDATED,
    booking_id: 'bk-1',
    stops: [{ id: 's1', sequence: 1, completed_at: '2026-08-29T10:00:00Z' }],
    ...overrides,
  },
});

describe('stopCompletionsFromNotification', () => {
  it('extracts completions for the tracked booking', () => {
    expect(stopCompletionsFromNotification(signal(), 'bk-1')).toEqual([
      { id: 's1', completed_at: '2026-08-29T10:00:00Z' },
    ]);
  });

  it('ignores other bookings, other types, and junk payloads', () => {
    expect(stopCompletionsFromNotification(signal(), 'bk-2')).toBeNull();
    expect(
      stopCompletionsFromNotification({ type: 'booking_update', data: { booking_id: 'bk-1' } }, 'bk-1'),
    ).toBeNull();
    expect(stopCompletionsFromNotification(signal({ stops: [] }), 'bk-1')).toBeNull();
    expect(stopCompletionsFromNotification(signal({ stops: [{ id: 7 }] }), 'bk-1')).toBeNull();
  });

  it('treats a missing completed_at as an un-tick (stop reopened)', () => {
    expect(
      stopCompletionsFromNotification(signal({ stops: [{ id: 's1', sequence: 1, completed_at: null }] }), 'bk-1'),
    ).toEqual([{ id: 's1', completed_at: null }]);
  });
});

describe('mergeStopCompletions', () => {
  it('merges by id and preserves fields the partial payload lacks', () => {
    const merged = mergeStopCompletions(
      [stop('s1'), stop('s2')],
      [{ id: 's2', completed_at: '2026-08-29T10:00:00Z' }],
    );
    expect(merged?.[1]).toMatchObject({
      id: 's2',
      address: 's2 street',
      completed_at: '2026-08-29T10:00:00Z',
    });
    expect(merged?.[0].completed_at).toBeNull();
  });

  it('returns null when nothing actually changes, so callers can skip the write', () => {
    expect(
      mergeStopCompletions([stop('s1', '2026-08-29T10:00:00Z')], [{ id: 's1', completed_at: '2026-08-29T10:00:00Z' }]),
    ).toBeNull();
    expect(mergeStopCompletions([stop('s1')], [{ id: 'unknown', completed_at: null }])).toBeNull();
    expect(mergeStopCompletions([], [{ id: 's1', completed_at: null }])).toBeNull();
  });

  it('applies an un-tick', () => {
    const merged = mergeStopCompletions(
      [stop('s1', '2026-08-29T10:00:00Z')],
      [{ id: 's1', completed_at: null }],
    );
    expect(merged?.[0].completed_at).toBeNull();
  });
});
