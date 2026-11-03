import { repeatDraft } from '../repeatDraft';
import { rebookDraft } from '../rebookDraft';
import { makeBooking } from '../../__mocks__/factories';
import type { Booking } from '../../types';

/**
 * Repeating a finished errand — Home's "Repeat last" and the rating screen's
 * "Book again" — rebuilds the WHOLE errand. The rating screen used to
 * preselect only the type, so every address and item was typed again.
 */
describe('repeatDraft', () => {
  const done = (over: Partial<Booking> = {}) =>
    makeBooking({
      status: 'completed',
      errand_type: { slug: 'delivery', name: 'Delivery' } as Booking['errand_type'],
      pickup_contact_name: 'Ana',
      dropoff_contact_phone: '09171234567',
      special_instructions: 'Gate 2',
      ...over,
    });

  it('copies the route, contacts, notes and vehicle — the same builder every "Book again" uses', () => {
    const source = done();
    const draft = repeatDraft(source, Date.parse('2026-11-03T08:00:00Z'));
    expect(draft).toEqual(rebookDraft(source, Date.parse('2026-11-03T08:00:00Z')));
    expect(draft).toMatchObject({
      errand_type_id: source.errand_type_id,
      errand_type_slug: 'delivery',
      pickup_address: source.pickup_address,
      pickup_lat: source.pickup_lat,
      dropoff_address: source.dropoff_address,
      pickup_contact_name: 'Ana',
      dropoff_contact_phone: '09171234567',
      special_instructions: 'Gate 2',
      vehicle_type_rate: 'motorcycle',
      schedule_type: 'now',
    });
  });

  it('keeps every stop of a multi-stop errand', () => {
    const draft = repeatDraft(
      done({
        stops: [{ address: 'C', lat: '14.7', lng: '121.1' }] as unknown as Booking['stops'],
      }),
    );
    expect(draft?.stops).toEqual([
      { address: 'C', lat: 14.7, lng: 121.1, contact_name: undefined, contact_phone: undefined, note: undefined },
    ]);
  });

  it('never copies how it was paid', () => {
    const draft = repeatDraft(done({ payment_method: 'gcash' }));
    expect(draft).not.toHaveProperty('payment_method');
  });

  it('gives up (null) without pickup coordinates, so the caller starts a type-only booking', () => {
    expect(repeatDraft(done({ pickup_lat: null as unknown as number }))).toBeNull();
    expect(repeatDraft(done({ pickup_lng: undefined as unknown as number }))).toBeNull();
  });
});
