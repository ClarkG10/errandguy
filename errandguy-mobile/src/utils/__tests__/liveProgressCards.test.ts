import { latestProgressCard, progressCardSignature } from '../liveProgressCards';
import { shoppingItemsFromNotification, SHOPPING_ITEMS_UPDATED } from '../shoppingChecklist';
import type { AppNotification } from '../../types';

const card = (over: Partial<AppNotification> & { data?: Record<string, unknown> }): AppNotification => ({
  id: 'n1',
  user_id: 'u1',
  title: 'Shopping list updated',
  body: '',
  type: 'shopping_items_updated' as AppNotification['type'],
  is_read: false,
  created_at: '2026-10-31T01:00:00Z',
  data: { type: 'shopping_items_updated', booking_id: 'b1', shopping_items: [] },
  ...over,
});

const items = (checked: boolean[]) =>
  checked.map((c, i) => ({ id: `i${i}`, name: `Item ${i}`, qty: 1, checked: c, checked_at: null }));

describe('live progress cards', () => {
  it("picks this errand's card of the right type", () => {
    const rows = [
      card({ id: 'other', data: { type: 'shopping_items_updated', booking_id: 'b2' } }),
      card({ id: 'stops', type: 'booking_stops_updated' as any, data: { type: 'booking_stops_updated', booking_id: 'b1' } }),
      card({ id: 'mine' }),
    ];
    expect(latestProgressCard(rows, SHOPPING_ITEMS_UPDATED, 'b1')?.id).toBe('mine');
    expect(latestProgressCard(rows, 'booking_stops_updated', 'b1')?.id).toBe('stops');
    expect(latestProgressCard(rows, SHOPPING_ITEMS_UPDATED, null)).toBeNull();
  });

  it('a second tick on the SAME coalesced card is a new signature (the bug: same id → ignored)', () => {
    const first = card({ data: { type: 'shopping_items_updated', booking_id: 'b1', shopping_items: items([true, false]) } });
    const second = card({
      created_at: '2026-10-31T01:00:09Z',
      data: { type: 'shopping_items_updated', booking_id: 'b1', shopping_items: items([true, true]) },
    });
    expect(second.id).toBe(first.id);
    expect(progressCardSignature(second)).not.toBe(progressCardSignature(first));
    // …and the payload it carries is the new checklist.
    expect(shoppingItemsFromNotification(second, 'b1')?.map((i) => i.checked)).toEqual([true, true]);
  });

  it('the same card re-delivered or re-fetched keeps its signature (applied once)', () => {
    const a = card({ data: { type: 'shopping_items_updated', booking_id: 'b1', shopping_items: items([true]) } });
    const refetched = { ...a, data: { ...a.data } };
    expect(progressCardSignature(refetched)).toBe(progressCardSignature(a));
    expect(progressCardSignature(null)).toBeNull();
  });
});
