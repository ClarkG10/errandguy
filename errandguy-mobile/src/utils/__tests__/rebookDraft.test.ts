import { rebookDraft } from '../rebookDraft';
import { makeBooking } from '../../__mocks__/factories';

const NOW = Date.parse('2026-11-02T08:00:00.000Z');

describe('rebookDraft — "Book again" from an errand that ended undone', () => {
  it('carries the route, contacts and items, with Laravel’s decimal strings coerced', () => {
    const draft = rebookDraft(
      makeBooking({
        pickup_lat: '14.5995' as unknown as number,
        pickup_lng: '120.9842' as unknown as number,
        dropoff_lat: '14.6' as unknown as number,
        dropoff_lng: '121.0' as unknown as number,
        pickup_contact_name: 'Ana',
        vehicle_type_rate: 'motorcycle',
        shopping_items: [{ id: 'i1', name: 'Eggs', qty: 2 }],
      }),
      NOW,
    );
    expect(draft).toMatchObject({
      errand_type_id: 'errand-type-001',
      pickup_lat: 14.5995,
      pickup_lng: 120.9842,
      dropoff_lat: 14.6,
      dropoff_lng: 121,
      pickup_contact_name: 'Ana',
      vehicle_type_rate: 'motorcycle',
      shoppingItems: [{ id: 'i1', name: 'Eggs', qty: 2 }],
    });
  });

  it('keeps every extra stop — dropping them re-priced a multi-stop errand as a single drop', () => {
    const draft = rebookDraft(
      makeBooking({
        stops: [
          { id: 's1', sequence: 1, address: '12 Rizal St', lat: '14.5' as unknown as number, lng: 121, contact_name: 'Ben', contact_phone: null, note: null },
        ],
      }),
      NOW,
    );
    expect(draft.stops).toEqual([
      { address: '12 Rizal St', lat: 14.5, lng: 121, contact_name: 'Ben', contact_phone: undefined, note: undefined },
    ]);
  });

  it('keeps a scheduled slot that is still ahead, and drops one that has passed', () => {
    const ahead = rebookDraft(
      makeBooking({ schedule_type: 'scheduled', scheduled_at: '2026-11-02T12:00:00.000Z' }),
      NOW,
    );
    expect(ahead).toMatchObject({ schedule_type: 'scheduled', scheduled_at: '2026-11-02T12:00:00.000Z' });

    const passed = rebookDraft(
      makeBooking({ schedule_type: 'scheduled', scheduled_at: '2026-11-02T07:00:00.000Z' }),
      NOW,
    );
    expect(passed).toMatchObject({ schedule_type: 'now', scheduled_at: undefined });
  });
});
