import {
  serializeChecklist,
  parseChecklist,
  shoppingProgress,
  shoppingItemsFromNotification,
} from '../shoppingChecklist';
import type { ChecklistItem } from '../../types/booking';

describe('shoppingChecklist', () => {
  const items: ChecklistItem[] = [
    { id: 'a', name: 'Milk', qty: 2 },
    { id: 'b', name: 'Whole wheat bread', qty: 1 },
    { id: 'c', name: 'Eggs', qty: 12 },
  ];

  it('round-trips serialize → parse losslessly for name + qty', () => {
    const text = serializeChecklist(items);
    const parsed = parseChecklist(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.items.map((i) => ({ name: i.name, qty: i.qty }))).toEqual(
      items.map((i) => ({ name: i.name, qty: i.qty })),
    );
    expect(parsed!.note).toBeUndefined();
  });

  it('round-trips an appended freeform note', () => {
    const note = 'No plastic bags please\nCall on arrival';
    const text = serializeChecklist(items, note);
    const parsed = parseChecklist(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(3);
    expect(parsed!.note).toBe(note);
  });

  it('generates stable index-based ids on parse', () => {
    const parsed = parseChecklist(serializeChecklist(items));
    expect(parsed!.items.map((i) => i.id)).toEqual([
      'item-0',
      'item-1',
      'item-2',
    ]);
  });

  it('renders human-readable text a runner can read as-is', () => {
    const text = serializeChecklist([{ id: 'a', name: 'Milk', qty: 2 }]);
    expect(text).toBe('Shopping list:\n• Milk ×2');
  });

  it('skips blank rows and floors qty to at least 1', () => {
    const text = serializeChecklist([
      { id: 'a', name: '  ', qty: 5 },
      { id: 'b', name: 'Rice', qty: 0 },
    ]);
    const parsed = parseChecklist(text);
    expect(parsed!.items).toEqual([{ id: 'item-0', name: 'Rice', qty: 1 }]);
  });

  it('returns null on plain free-text descriptions', () => {
    expect(parseChecklist('Please buy 2 milks and some bread')).toBeNull();
    expect(parseChecklist('Deliver this envelope to the office')).toBeNull();
  });

  it('returns null on empty / nullish input', () => {
    expect(parseChecklist(null)).toBeNull();
    expect(parseChecklist(undefined)).toBeNull();
    expect(parseChecklist('')).toBeNull();
  });

  it('returns null when the header has no parseable items', () => {
    expect(parseChecklist('Shopping list:\njust some prose here')).toBeNull();
  });

  it('tolerates a plain "x" separator and extra spacing', () => {
    const parsed = parseChecklist('Shopping list:\n-  Bananas   x 6');
    expect(parsed!.items).toEqual([{ id: 'item-0', name: 'Bananas', qty: 6 }]);
  });
});

describe('shoppingProgress', () => {
  const item = (id: string, checked?: boolean) => ({
    id,
    name: id,
    qty: 1,
    ...(checked === undefined ? {} : { checked }),
  });

  it('counts ticked lines and reports the ratio', () => {
    const p = shoppingProgress([item('a', true), item('b'), item('c', true), item('d', false)]);
    expect(p).toEqual({ picked: 2, total: 4, ratio: 0.5, allPicked: false });
  });

  it('treats a missing `checked` flag as not picked', () => {
    // A list the runner has never touched comes back without the tick keys.
    expect(shoppingProgress([item('a'), item('b')])).toEqual({
      picked: 0,
      total: 2,
      ratio: 0,
      allPicked: false,
    });
  });

  it('flags allPicked only when every line is ticked', () => {
    expect(shoppingProgress([item('a', true), item('b', true)]).allPicked).toBe(true);
    expect(shoppingProgress([item('a', true), item('b', false)]).allPicked).toBe(false);
  });

  it('never divides by zero on an empty / absent list', () => {
    for (const input of [[], null, undefined]) {
      expect(shoppingProgress(input)).toEqual({
        picked: 0,
        total: 0,
        ratio: 0,
        allPicked: false,
      });
    }
  });
});

describe('shoppingItemsFromNotification', () => {
  const BOOKING = 'bk-1';
  const payload = (overrides: Record<string, unknown> = {}) => ({
    type: 'shopping_items_updated',
    data: {
      type: 'shopping_items_updated',
      booking_id: BOOKING,
      shopping_items: [
        { id: 'i1', name: 'Milk', qty: 2, checked: true, checked_at: '2026-08-29T01:00:00+08:00' },
        { id: 'i2', name: 'Bread', qty: 1, checked: false, checked_at: null },
      ],
      ...overrides,
    },
  });

  it('returns the refreshed list for this booking', () => {
    expect(shoppingItemsFromNotification(payload(), BOOKING)).toEqual([
      { id: 'i1', name: 'Milk', qty: 2, checked: true, checked_at: '2026-08-29T01:00:00+08:00' },
      { id: 'i2', name: 'Bread', qty: 1, checked: false, checked_at: null },
    ]);
  });

  it('ignores a row for another booking', () => {
    expect(shoppingItemsFromNotification(payload(), 'bk-2')).toBeNull();
    expect(shoppingItemsFromNotification(payload({ booking_id: 'bk-9' }), BOOKING)).toBeNull();
  });

  it('ignores every other notification type', () => {
    const other = {
      type: 'booking_update',
      data: { type: 'booking_update', booking_id: BOOKING, shopping_items: [{ id: 'i1', name: 'Milk', qty: 1 }] },
    };
    expect(shoppingItemsFromNotification(other, BOOKING)).toBeNull();
  });

  it('falls back to the top-level type column when the bag omits it', () => {
    const noBagType = {
      type: 'shopping_items_updated',
      data: { booking_id: BOOKING, shopping_items: [{ id: 'i1', name: 'Milk', qty: 1 }] },
    };
    expect(shoppingItemsFromNotification(noBagType, BOOKING)).toHaveLength(1);
  });

  it('refuses an empty list rather than blanking the customer’s card', () => {
    // The tick endpoint 422s when the booking has no list, so an empty
    // broadcast can only be malformed.
    expect(shoppingItemsFromNotification(payload({ shopping_items: [] }), BOOKING)).toBeNull();
  });

  it('refuses a payload with an unusable row instead of half-applying it', () => {
    const bad = payload({
      shopping_items: [
        { id: 'i1', name: 'Milk', qty: 1 },
        { name: 'no id here', qty: 1 },
      ],
    });
    expect(shoppingItemsFromNotification(bad, BOOKING)).toBeNull();
    expect(
      shoppingItemsFromNotification(payload({ shopping_items: [null] }), BOOKING),
    ).toBeNull();
    expect(
      shoppingItemsFromNotification(payload({ shopping_items: 'nope' }), BOOKING),
    ).toBeNull();
  });

  it('normalises a missing / junk quantity to 1 and a missing tick to false', () => {
    const loose = payload({ shopping_items: [{ id: 'i1', name: 'Milk' }] });
    expect(shoppingItemsFromNotification(loose, BOOKING)).toEqual([
      { id: 'i1', name: 'Milk', qty: 1, checked: false, checked_at: null },
    ]);
  });

  it('is a no-op without a signal or a booking id', () => {
    expect(shoppingItemsFromNotification(null, BOOKING)).toBeNull();
    expect(shoppingItemsFromNotification(undefined, BOOKING)).toBeNull();
    expect(shoppingItemsFromNotification(payload(), null)).toBeNull();
    expect(shoppingItemsFromNotification(payload(), undefined)).toBeNull();
  });
});
