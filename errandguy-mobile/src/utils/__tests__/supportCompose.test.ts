import { composePrefillFromParams, SUPPORT_CATEGORIES } from '../supportCompose';

/**
 * "Report a problem" on an errand must open a NEW ticket about that errand —
 * not the empty inbox. The deep link carries the errand and a category; the
 * support screen turns it into a composer prefill with this.
 */
describe('composePrefillFromParams', () => {
  it('opens plainly (no prefill) when the screen is reached from Help', () => {
    expect(composePrefillFromParams({})).toBeNull();
  });

  it('links the errand and picks the category from the tracking screen', () => {
    expect(
      composePrefillFromParams({
        compose: '1',
        category: 'booking',
        booking_id: 'bk-1',
        booking_number: 'EG-1234',
      }),
    ).toEqual({
      category: 'booking',
      subject: 'Problem with errand EG-1234',
      errand: { id: 'bk-1', number: 'EG-1234' },
    });
  });

  it('a safety report gets a safety subject', () => {
    expect(
      composePrefillFromParams({ compose: '1', category: 'safety', booking_id: 'bk-1', booking_number: 'EG-9' }),
    ).toMatchObject({ category: 'safety', subject: 'Safety concern — EG-9' });
  });

  it('holds a stray category to the chips the composer offers', () => {
    const p = composePrefillFromParams({ category: 'refund_me_now', booking_id: 'bk-1' });
    expect(p?.category).toBe('booking');
    expect(SUPPORT_CATEGORIES.map((c) => c.key)).toContain(p?.category);
  });

  it('a bare compose link opens an empty, unlinked composer', () => {
    expect(composePrefillFromParams({ compose: '1' })).toEqual({
      category: 'general',
      subject: '',
      errand: null,
    });
  });
});
