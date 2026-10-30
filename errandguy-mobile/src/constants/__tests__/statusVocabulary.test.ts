import {
  STATUS_LABELS,
  STATUS_COLORS,
  STATUS_TEXT_COLORS,
  statusLabel,
  statusHeadline,
} from '../statusLabels';
import type { BookingStatus } from '../../types';

const ALL_STATUSES = Object.keys(STATUS_LABELS) as BookingStatus[];

/**
 * One booking status used to render 8+ different ways across the surfaces a
 * single errand touches — six independent label maps in mobile alone, so a
 * single-location customer read one thing in the tracking hero and "Picked Up"
 * on the Activity row and home card describing the same moment, and `no_runner`
 * had seven spellings including a singular/plural flip.
 *
 * These pin the single vocabulary both registers now come from.
 */
describe('statusLabel (terse register)', () => {
  it('falls back to the base label for every status when no type is given', () => {
    for (const status of ALL_STATUSES) {
      expect(statusLabel(status)).toBe(STATUS_LABELS[status]);
    }
  });

  it('falls back to the base label for an unknown errand type', () => {
    expect(statusLabel('picked_up', 'some-future-type')).toBe(STATUS_LABELS.picked_up);
  });

  it('never claims an item was picked up on an errand that has none', () => {
    expect(statusLabel('picked_up', 'queue')).toBe('At the front');
    // Shopping flows really do hand over an item — base label is correct.
    expect(statusLabel('picked_up', 'purchase')).toBe('Picked up');
  });

  /**
   * Bills payment is retired, but an in-progress one still ends at the
   * payment counter — it reads as single-location work, not a parcel.
   */
  it('reads a legacy bill payment as single-location work', () => {
    expect(statusLabel('arrived_at_pickup', 'bills_payment')).toBe('On site');
    expect(statusLabel('picked_up', 'bills_payment')).toBe('Task done');
  });

  /**
   * Passenger rides are retired. A ride booked before the cut reads exactly
   * like the delivery it now finishes as — no driver vocabulary is left.
   */
  it('reads a legacy ride with the plain delivery vocabulary', () => {
    for (const status of ALL_STATUSES) {
      expect(statusLabel(status, 'transportation')).toBe(statusLabel(status, 'delivery'));
      expect(statusLabel(status, 'transportation')).not.toMatch(/driver|ride|trip/i);
    }
  });

  /**
   * The wording that mattered most: this is the state where the customer has
   * to decide whether to rebook, and it was spelled "No Runner Available",
   * "No runners available", "No runner available" and "No runner found"
   * depending on which screen they happened to be looking at.
   */
  it('pins no_runner to one singular spelling', () => {
    expect(STATUS_LABELS.no_runner).toBe('No runner available');
    expect(statusLabel('no_runner')).toBe('No runner available');
    expect(statusHeadline('no_runner')).toBe('No runner available');
  });

  it('is sentence case throughout, so chips match the push titles', () => {
    for (const status of ALL_STATUSES) {
      // Capital first letter, no further capitals — the same rule the API's
      // PushCopyConsistencyTest enforces on notification titles.
      expect(STATUS_LABELS[status]).toMatch(/^[A-Z][^A-Z]*$/);
    }
  });

  it('returns the raw status for anything unmapped rather than blank', () => {
    expect(statusLabel('some_new_status' as BookingStatus)).toBe('some_new_status');
  });

  it('keeps a colour rung for every status it can label', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_COLORS[status]).toBeTruthy();
      expect(STATUS_TEXT_COLORS[status]).toBeTruthy();
    }
  });
});

describe('statusHeadline (conversational register)', () => {
  it('names the runner when one is attached', () => {
    expect(statusHeadline('accepted', { runnerFirstName: 'Ana' })).toBe('Ana is on the way');
    expect(statusHeadline('accepted')).toBe('Runner is on the way');
  });

  /**
   * The home card said "Ana is en route" and the tracking screen it links
   * into said "On the way to you" — two phrasings for the same fact, one tap
   * apart. Both now come from here.
   */
  it('phrases in_transit as being on the way to the customer', () => {
    expect(statusHeadline('in_transit', { runnerFirstName: 'Ana' })).toBe(
      'Ana is on the way to you',
    );
    expect(statusHeadline('in_transit', { runnerFirstName: 'Ana' })).not.toContain('en route');
  });

  it('does not narrate a parcel on errands that have none', () => {
    expect(statusHeadline('picked_up', { errandSlug: 'queue', runnerFirstName: 'Ana' }))
      .toBe('Ana reached the front of the line');
    expect(statusHeadline('picked_up', { errandSlug: 'bills_payment', runnerFirstName: 'Ana' }))
      .toBe('Ana is wrapping up');
    // …and still does on a delivery, where there IS one.
    expect(statusHeadline('picked_up', { errandSlug: 'delivery', runnerFirstName: 'Ana' }))
      .toBe('Ana picked up your item');
  });

  it('narrates a legacy ride like the delivery it now finishes as', () => {
    for (const status of ALL_STATUSES) {
      expect(statusHeadline(status, { errandSlug: 'transportation' })).toBe(
        statusHeadline(status, { errandSlug: 'delivery' }),
      );
    }
    expect(statusHeadline('accepted', { errandSlug: 'transportation' })).toBe(
      'Runner is on the way',
    );
  });

  it('returns a non-empty phrase for every status and every type, current or legacy', () => {
    for (const slug of [
      undefined,
      'delivery',
      'purchase',
      'queue',
      'custom',
      // Retired slugs still carried by older bookings.
      'grocery',
      'food',
      'document',
      'laundry',
      'transportation',
      'bills_payment',
    ]) {
      for (const status of ALL_STATUSES) {
        const phrase = statusHeadline(status, { errandSlug: slug });
        expect(phrase.length).toBeGreaterThan(0);
        expect(phrase).not.toContain('undefined');
      }
    }
  });
});
