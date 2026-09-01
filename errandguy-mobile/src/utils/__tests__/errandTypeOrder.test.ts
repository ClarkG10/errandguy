import {
  MIN_BOOKINGS_TO_PROMOTE,
  applyErrandTypeOrder,
  countErrandTypeUsage,
  rankErrandTypesByUsage,
} from '../errandTypeOrder';

// The seeded catalogue order (sort_order), abbreviated: the services a repeat
// customer actually books — laundry (5th), bills (7th) — sit well past the
// four tiles Home renders.
const CATALOGUE = [
  { id: 'delivery' },
  { id: 'food' },
  { id: 'grocery' },
  { id: 'pharmacy' },
  { id: 'laundry' },
  { id: 'transportation' },
  { id: 'bills' },
];

const ids = (types: { id: string }[]) => types.map((t) => t.id);
const booked = (...typeIds: string[]) =>
  typeIds.map((errand_type_id) => ({ errand_type_id }));

describe('countErrandTypeUsage', () => {
  it('counts per type and ignores bookings with no type', () => {
    const counts = countErrandTypeUsage([
      ...booked('laundry', 'laundry', 'food'),
      { errand_type_id: null },
      { errand_type_id: undefined },
    ]);
    expect(counts.get('laundry')).toBe(2);
    expect(counts.get('food')).toBe(1);
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
    expect(ids(rankErrandTypesByUsage(CATALOGUE, booked('bills')))).toEqual(
      ids(CATALOGUE),
    );
  });

  it('lifts the customer\'s own service onto the first tile at the threshold', () => {
    const ordered = rankErrandTypesByUsage(
      CATALOGUE,
      booked(...Array(MIN_BOOKINGS_TO_PROMOTE).fill('laundry')),
    );
    expect(ids(ordered)[0]).toBe('laundry');
    // Everything else keeps its catalogue order behind it.
    expect(ids(ordered)).toEqual([
      'laundry',
      'delivery',
      'food',
      'grocery',
      'pharmacy',
      'transportation',
      'bills',
    ]);
  });

  it('orders several promoted types by count, then by catalogue order', () => {
    const ordered = rankErrandTypesByUsage(
      CATALOGUE,
      booked(
        'bills',
        'bills',
        'bills',
        'laundry',
        'laundry',
        'food',
        'food',
        'pharmacy', // single booking — stays where the catalogue put it
      ),
    );
    // bills (3) first; food and laundry tie at 2 and fall back to sort_order,
    // where food (2nd) precedes laundry (5th).
    expect(ids(ordered)).toEqual([
      'bills',
      'food',
      'laundry',
      'delivery',
      'grocery',
      'pharmacy',
      'transportation',
    ]);
  });

  it('is a pure permutation — nothing is added or dropped', () => {
    const ordered = rankErrandTypesByUsage(CATALOGUE, booked('bills', 'bills'));
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
    const pinned = ids(rankErrandTypesByUsage(CATALOGUE, booked('bills', 'bills')));
    // The window later gains a laundry run; the pinned order still wins.
    expect(ids(applyErrandTypeOrder(CATALOGUE, pinned))).toEqual(pinned);
  });

  it('ignores pinned ids that left the catalogue', () => {
    expect(
      ids(applyErrandTypeOrder(CATALOGUE, ['retired-type', 'bills'])),
    ).toEqual([
      'bills',
      'delivery',
      'food',
      'grocery',
      'pharmacy',
      'laundry',
      'transportation',
    ]);
  });

  it('appends catalogue members the pinned order has never seen', () => {
    const withNewType = [...CATALOGUE, { id: 'brand-new' }];
    expect(ids(applyErrandTypeOrder(withNewType, ['bills']))).toEqual([
      'bills',
      'delivery',
      'food',
      'grocery',
      'pharmacy',
      'laundry',
      'transportation',
      'brand-new',
    ]);
  });
});
