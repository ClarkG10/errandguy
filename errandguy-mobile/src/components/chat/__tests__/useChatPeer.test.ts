import { isClosedBookingStatus } from '../useChatPeer';

/**
 * The composer gate hangs off this predicate, so its FAIL-OPEN behaviour is
 * the important part: while the booking status is still unknown the thread
 * must stay writable (the server remains the real enforcement). Only the
 * statuses we are certain about turn the composer into a read-only notice.
 */
describe('isClosedBookingStatus', () => {
  it('closes the thread on the statuses that have genuinely ended', () => {
    // completed + cancelled are what ChatController::store 422s on.
    expect(isClosedBookingStatus('completed')).toBe(true);
    expect(isClosedBookingStatus('cancelled')).toBe(true);
    // no_runner has no counterparty at all.
    expect(isClosedBookingStatus('no_runner')).toBe(true);
  });

  it('keeps every live status writable', () => {
    for (const status of [
      'pending',
      'negotiate',
      'matched',
      'accepted',
      'heading_to_pickup',
      'arrived_at_pickup',
      'picked_up',
      'in_transit',
      'arrived_at_dropoff',
      'delivered',
    ]) {
      expect(isClosedBookingStatus(status)).toBe(false);
    }
  });

  it('fails open when the status is unknown', () => {
    expect(isClosedBookingStatus(null)).toBe(false);
    expect(isClosedBookingStatus(undefined)).toBe(false);
    expect(isClosedBookingStatus('')).toBe(false);
    expect(isClosedBookingStatus('some_future_status')).toBe(false);
  });
});
