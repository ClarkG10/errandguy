import {
  MAX_ACTIVE_CARDS,
  mergeActiveBookings,
  parseActiveBookings,
} from '../activeBookings';
import type { Booking } from '../../types';

const b = (id: string, extra: Partial<Booking> = {}) =>
  ({ id, status: 'accepted', ...extra }) as Booking;

describe('parseActiveBookings', () => {
  it('reads the additive array', () => {
    expect(
      parseActiveBookings({ data: b('one'), active_bookings: [b('one'), b('two')] }).map(
        (x) => x.id,
      ),
    ).toEqual(['one', 'two']);
  });

  it('falls back to the singular key when the array is absent (older API)', () => {
    expect(parseActiveBookings({ data: b('one') }).map((x) => x.id)).toEqual(['one']);
  });

  it('answers empty for no active errand, a null body, or a junk array', () => {
    expect(parseActiveBookings({ data: null })).toEqual([]);
    expect(parseActiveBookings(null)).toEqual([]);
    expect(parseActiveBookings({ active_bookings: 'nope' } as never)).toEqual([]);
    expect(
      parseActiveBookings({ active_bookings: [null, { id: 7 }] } as never),
    ).toEqual([]);
  });
});

describe('mergeActiveBookings', () => {
  it('keeps the store copy of the primary booking, in first position', () => {
    const store = b('live', { status: 'in_transit' });
    const stale = b('live', { status: 'pending' });
    const merged = mergeActiveBookings(store, [stale, b('later')]);
    expect(merged.map((x) => x.id)).toEqual(['live', 'later']);
    // The realtime channel heals the store object — it must win the merge.
    expect(merged[0].status).toBe('in_transit');
  });

  it('renders the store booking alone while the list is still in flight', () => {
    expect(mergeActiveBookings(b('live'), null).map((x) => x.id)).toEqual(['live']);
  });

  it('renders the list when the store has nothing yet', () => {
    expect(mergeActiveBookings(null, [b('a'), b('b')]).map((x) => x.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('caps the stack', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => b(id));
    expect(mergeActiveBookings(null, many)).toHaveLength(MAX_ACTIVE_CARDS);
    expect(mergeActiveBookings(b('primary'), many).map((x) => x.id)).toEqual([
      'primary',
      'a',
      'b',
    ]);
  });

  it('de-duplicates repeated ids', () => {
    expect(
      mergeActiveBookings(null, [b('a'), b('a'), b('b')]).map((x) => x.id),
    ).toEqual(['a', 'b']);
  });

  it('discards a store booking that was spliced from another booking\'s broadcast', () => {
    // useBookingStatus merged booking B's payload into booking A's object, so
    // the store now claims id 'b' while carrying A's booking_number.
    const spliced = { id: 'b', booking_number: 'EG-A', status: 'in_transit' } as Booking;
    const merged = mergeActiveBookings(spliced, [
      { id: 'a', booking_number: 'EG-A' } as Booking,
      { id: 'b', booking_number: 'EG-B' } as Booking,
    ]);
    // Server truth only — and in the server's order, not the corrupt claim.
    expect(merged.map((x) => x.id)).toEqual(['a', 'b']);
    expect(merged.map((x) => x.booking_number)).toEqual(['EG-A', 'EG-B']);
  });

  it('still prefers the store copy when the two agree on the booking number', () => {
    const store = { id: 'a', booking_number: 'EG-A', status: 'in_transit' } as Booking;
    const merged = mergeActiveBookings(store, [
      { id: 'a', booking_number: 'EG-A', status: 'pending' } as Booking,
    ]);
    expect(merged[0].status).toBe('in_transit');
  });

  it('answers empty when there is nothing active at all', () => {
    expect(mergeActiveBookings(null, [])).toEqual([]);
  });
});
