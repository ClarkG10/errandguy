import { notificationInvalidationKeys } from '../notificationInvalidations';

describe('notificationInvalidationKeys', () => {
  describe('booking_update', () => {
    it('invalidates the active-booking card and every booking list', () => {
      expect(notificationInvalidationKeys({ type: 'booking_update', data: {} })).toEqual([
        ['booking', 'active'],
        ['bookings'],
      ]);
    });

    it('also invalidates the specific booking when the id is present', () => {
      expect(
        notificationInvalidationKeys({
          type: 'booking_update',
          data: { type: 'booking_update', booking_id: 'bk-1' },
        }),
      ).toEqual([['booking', 'active'], ['bookings'], ['booking', 'bk-1']]);
    });

    it('accepts a numeric booking id off the wire', () => {
      expect(
        notificationInvalidationKeys({ type: 'booking_update', data: { booking_id: 42 } }),
      ).toContainEqual(['booking', '42']);
    });

    it('ignores a blank / non-scalar booking id', () => {
      expect(
        notificationInvalidationKeys({ type: 'booking_update', data: { booking_id: '   ' } }),
      ).toEqual([['booking', 'active'], ['bookings']]);
      expect(
        notificationInvalidationKeys({ type: 'booking_update', data: { booking_id: { a: 1 } } }),
      ).toEqual([['booking', 'active'], ['bookings']]);
    });
  });

  describe('support', () => {
    it('invalidates the ticket list and the named thread on a reply', () => {
      expect(
        notificationInvalidationKeys({
          type: 'support_reply',
          data: { type: 'support_reply', ticket_id: '9' },
        }),
      ).toEqual([['support', 'tickets'], ['support', 'ticket', '9']]);
    });

    it('handles a status change the same way', () => {
      expect(
        notificationInvalidationKeys({
          type: 'support_status',
          data: { ticket_id: '9', status: 'resolved' },
        }),
      ).toEqual([['support', 'tickets'], ['support', 'ticket', '9']]);
    });

    it('falls back to the list alone when no ticket id is carried', () => {
      expect(notificationInvalidationKeys({ type: 'support_status', data: {} })).toEqual([
        ['support', 'tickets'],
      ]);
    });
  });

  it('maps a KYC decision to the runner profile', () => {
    expect(
      notificationInvalidationKeys({ type: 'document_update', data: { type: 'document_update' } }),
    ).toEqual([['runner', 'profile']]);
  });

  it('maps a payout / wallet event to the payout and wallet keys', () => {
    expect(notificationInvalidationKeys({ type: 'payment', data: {} })).toEqual([
      ['runner', 'payouts'],
      ['wallet'],
    ]);
  });

  describe('unknown / malformed input behaves exactly as before (no invalidation)', () => {
    it.each([
      ['promo', { type: 'promo', data: {} }],
      ['system', { type: 'system', data: {} }],
      ['sos', { type: 'sos', data: { booking_id: 'bk-1' } }],
      ['chat', { type: 'chat', data: { booking_id: 'bk-1' } }],
      ['referral', { type: 'referral', data: {} }],
      ['incoming_request', { type: 'incoming_request', data: {} }],
      ['a type we have never seen', { type: 'quantum_update', data: {} }],
      ['no type at all', { data: { booking_id: 'bk-1' } }],
      ['an empty type', { type: '', data: {} }],
      ['a null data bag', { type: 'promo', data: null }],
    ])('%s → []', (_label, signal) => {
      expect(notificationInvalidationKeys(signal)).toEqual([]);
    });

    it('tolerates a null / undefined signal', () => {
      expect(notificationInvalidationKeys(null)).toEqual([]);
      expect(notificationInvalidationKeys(undefined)).toEqual([]);
    });
  });

  it('reads the type out of the data bag when the column is missing', () => {
    expect(notificationInvalidationKeys({ data: { type: 'document_update' } })).toEqual([
      ['runner', 'profile'],
    ]);
  });
});
