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
 * bills-payment customer read "Bill paid" in the tracking hero and "Picked Up"
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
    expect(statusLabel('picked_up', 'bills_payment')).toBe('Bill paid');
    expect(statusLabel('picked_up', 'queue')).toBe('At the front');
    expect(statusLabel('picked_up', 'transportation')).toBe('Ride started');
    // Shopping flows really do hand over an item — base label is correct.
    expect(statusLabel('picked_up', 'grocery')).toBe('Picked up');
  });

  it('never describes a passenger as delivered', () => {
    expect(statusLabel('delivered', 'transportation')).toBe('Trip complete');
    expect(statusLabel('completed', 'transportation')).toBe('Trip complete');
  });

  it('calls the runner a driver on a ride, matching the ride push copy', () => {
    expect(statusLabel('pending', 'transportation')).toBe('Finding a driver');
    expect(statusLabel('no_runner', 'transportation')).toBe('No driver available');
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
    expect(statusHeadline('picked_up', { errandSlug: 'bills_payment', runnerFirstName: 'Ana' }))
      .toBe('Bill paid — receipt on the way');
    expect(statusHeadline('picked_up', { errandSlug: 'queue', runnerFirstName: 'Ana' }))
      .toBe('Ana reached the front of the line');
    expect(statusHeadline('picked_up', { errandSlug: 'transportation' }))
      .toBe('On the way to your destination');
    // …and still does on a delivery, where there IS one.
    expect(statusHeadline('picked_up', { errandSlug: 'delivery', runnerFirstName: 'Ana' }))
      .toBe('Ana picked up your item');
  });

  it('calls the runner a driver on a ride even with no runner attached', () => {
    expect(statusHeadline('accepted', { errandSlug: 'transportation' })).toBe(
      'Driver is on the way',
    );
    expect(statusHeadline('pending', { errandSlug: 'transportation' })).toBe(
      'Looking for a driver nearby…',
    );
  });

  it('returns a non-empty phrase for every status and every mapped type', () => {
    for (const slug of [
      undefined,
      'delivery',
      'grocery',
      'food',
      'transportation',
      'bills_payment',
      'queue',
      'purchase',
    ]) {
      for (const status of ALL_STATUSES) {
        const phrase = statusHeadline(status, { errandSlug: slug });
        expect(phrase.length).toBeGreaterThan(0);
        expect(phrase).not.toContain('undefined');
      }
    }
  });
});
