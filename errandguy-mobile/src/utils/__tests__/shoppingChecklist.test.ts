import {
  serializeChecklist,
  parseChecklist,
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
