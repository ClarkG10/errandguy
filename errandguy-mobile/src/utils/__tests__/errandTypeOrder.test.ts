import {
  MIN_BOOKINGS_TO_PROMOTE,
  applyErrandTypeOrder,
  countErrandTypeUsage,
  rankErrandTypesByUsage,
} from '../errandTypeOrder';

// The current catalogue in sort_order: delivery, "Buy for me", queue, custom.
const CATALOGUE = [
  { id: 'delivery' },
  { id: 'purchase' },
  { id: 'queue' },
  { id: 'custom' },
];

const ids = (types: { id: string }[]) => types.map((t) => t.id);
const booked = (...typeIds: string[]) =>
  typeIds.map((errand_type_id) => ({ errand_type_id }));

describe('countErrandTypeUsage', () => {
  it('counts per type and ignores bookings with no type', () => {
    const counts = countErrandTypeUsage([
      ...booked('queue', 'queue', 'purchase'),
      { errand_type_id: null },
      { errand_type_id: undefined },
    ]);
    expect(counts.get('queue')).toBe(2);
    expect(counts.get('purchase')).toBe(1);
    expect(counts.size).toBe(2);
  });

  it('survives a null window', () => {
    expect(countErrandTypeUsage(null).size).toBe(0);
  });
});

describe('rankErrandTypesByUsage', () => {
  it('leaves the catalogue untouched for a brand-new customer', () => {
    expect(ids(rankErrandTypesByUsage(CATALOGUE, []))).toEqual(ids(CATALOGUE));
  });

  it('does NOT promote a type booked only once — one tap is not a habit', () => {
    expect(ids(rankErrandTypesByUsage(CATALOGUE, booked('custom')))).toEqual(
      ids(CATALOGUE),
    );
  });

  it('lifts the customer\'s own service onto the first tile at the threshold', () => {
    const ordered = rankErrandTypesByUsage(
      CATALOGUE,
      booked(...Array(MIN_BOOKINGS_TO_PROMOTE).fill('queue')),
    );
    expect(ids(ordered)[0]).toBe('queue');
    // Everything else keeps its catalogue order behind it.
    expect(ids(ordered)).toEqual(['queue', 'delivery', 'purchase', 'custom']);
  });

  it('orders several promoted types by count, then by catalogue order', () => {
    const ordered = rankErrandTypesByUsage(
      CATALOGUE,
      booked(
        'custom',
        'custom',
        'custom',
        'queue',
        'queue',
        'purchase',
        'purchase',
        'delivery', // single booking — stays where the catalogue put it
      ),
    );
    // custom (3) first; purchase and queue tie at 2 and fall back to
    // sort_order, where purchase (2nd) precedes queue (3rd).
    expect(ids(ordered)).toEqual(['custom', 'purchase', 'queue', 'delivery']);
  });

  it('never counts a booking of a type outside the catalogue', () => {
    // Older bookings keep their retired type; it is not in the catalogue, so
    // it can neither be promoted nor reshuffle the current types.
    expect(ids(rankErrandTypesByUsage(CATALOGUE, booked('food', 'food', 'food')))).toEqual(
      ids(CATALOGUE),
    );
  });

  it('is a pure permutation — nothing is added or dropped', () => {
    const ordered = rankErrandTypesByUsage(CATALOGUE, booked('custom', 'custom'));
    expect(ordered).toHaveLength(CATALOGUE.length);
    expect(ids(ordered).sort()).toEqual(ids(CATALOGUE).sort());
  });

  it('tolerates a null/empty catalogue and a null window', () => {
    expect(rankErrandTypesByUsage(null, null)).toEqual([]);
    expect(ids(rankErrandTypesByUsage(CATALOGUE, null))).toEqual(ids(CATALOGUE));
  });
});

describe('applyErrandTypeOrder', () => {
  it('is a no-op without a pinned order (cold cache falls back to sort_order)', () => {
    expect(ids(applyErrandTypeOrder(CATALOGUE, null))).toEqual(ids(CATALOGUE));
    expect(ids(applyErrandTypeOrder(CATALOGUE, []))).toEqual(ids(CATALOGUE));
  });

  it('replays a pinned order so tiles do not move mid-session', () => {
    const pinned = ids(rankErrandTypesByUsage(CATALOGUE, booked('custom', 'custom')));
    // The window later gains a queue job; the pinned order still wins.
    expect(ids(applyErrandTypeOrder(CATALOGUE, pinned))).toEqual(pinned);
  });

  it('ignores pinned ids that left the catalogue', () => {
    expect(ids(applyErrandTypeOrder(CATALOGUE, ['retired-type', 'custom']))).toEqual([
      'custom',
      'delivery',
      'purchase',
      'queue',
    ]);
  });

  it('appends catalogue members the pinned order has never seen', () => {
    const withNewType = [...CATALOGUE, { id: 'brand-new' }];
    expect(ids(applyErrandTypeOrder(withNewType, ['custom']))).toEqual([
      'custom',
      'delivery',
      'purchase',
      'queue',
      'brand-new',
    ]);
  });
});
