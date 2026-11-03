import type { Booking } from '../types';
import type { DraftBooking } from '../stores/bookingStore';
import { rebookDraft } from './rebookDraft';

/**
 * The draft for repeating a finished errand — Home's "Repeat last" and
 * "Frequently booked", and "Book again" after rating — so the customer lands
 * on a pre-filled Review: same type, addresses, contacts, stops, items and
 * vehicle. Payment is never copied; it is picked again on Review.
 *
 * Null when the source has no pickup coordinates to rebuild the route from;
 * the caller then starts a type-only booking and the customer re-picks the
 * places.
 *
 * Built by the same rebookDraft every "Book again" uses, so a repeat can't
 * drop the extra stops (and re-price as a cheaper single drop) or carry a
 * time that has already passed.
 */
export function repeatDraft(b: Booking, now: number = Date.now()): Partial<DraftBooking> | null {
  if (b.pickup_lat == null || b.pickup_lng == null) return null;
  return rebookDraft(b, now);
}
