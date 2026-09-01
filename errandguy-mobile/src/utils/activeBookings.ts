/**
 * The customer's set of in-flight errands.
 *
 * `GET /bookings/active` used to answer with exactly one booking, and Home
 * rendered exactly one card. Nothing caps concurrent bookings server-side and a
 * scheduled booking sits at status `pending` for days, so the active set
 * routinely has two or more members — and every one but the top of the ranking
 * was invisible: no card on Home, and the customer layout pointed its single
 * realtime status channel at that one id, so the others also stopped receiving
 * live updates.
 *
 * The endpoint now carries an ADDITIVE `active_bookings` array alongside the
 * unchanged singular `data` key (`active_bookings[0]` is the same row), ranked
 * so a booking already in its matching window outranks one scheduled for the
 * future. These helpers read that array defensively — an older API, an offline
 * cache or a 304-served body may not have it — and merge it with the store's
 * authoritative singular booking.
 */

import type { Booking } from '../types';

/**
 * Cards rendered on Home / channels mounted by the customer layout. Mirrors the
 * server-side cap on `active_bookings` (BookingController::active), so this is
 * a guard rather than a second, disagreeing policy.
 */
export const MAX_ACTIVE_CARDS = 3;

/**
 * Pull the active list out of a raw `/bookings/active` body.
 *
 * Falls back to the singular `data` key whenever the array is missing, so a
 * client running against an API that predates the additive field behaves
 * exactly as it did before (one booking, or none).
 */
export function parseActiveBookings(
  payload:
    | { data?: Booking | null; active_bookings?: unknown }
    | null
    | undefined,
): Booking[] {
  const list = payload?.active_bookings;
  if (Array.isArray(list)) {
    return list.filter((b): b is Booking => !!b && typeof b.id === 'string');
  }
  const single = payload?.data ?? null;
  return single && typeof single.id === 'string' ? [single] : [];
}

/**
 * Merge the store's singular active booking with the fetched list.
 *
 * `primary` wins position 1 and its OBJECT wins the merge: the realtime
 * `booking.{id}` channel heals that one in place (useBookingStatus merges the
 * broadcast into `bookingStore.activeBooking`), so preferring it keeps a status
 * move instant instead of waiting for the list to refetch. It is also kept even
 * when the list hasn't arrived yet — on a cold start the store paints from the
 * boot snapshot while the list is still in flight.
 *
 * De-duplicates by id and caps at `cap`. Callers filter for renderability
 * BEFORE calling (see `isRenderableActiveBooking`), so the cap can never spend
 * a slot on a card that won't render.
 *
 * ONE SAFETY VALVE. useBookingStatus merges any `booking.status` broadcast into
 * `bookingStore.activeBooking` without checking that the payload's `id` is the
 * booking it holds (src/hooks/useBookingStatus.ts:24-26), and the broadcast
 * carries its own id — so viewing a SECOND errand's tracking screen can splice
 * that errand's id and status onto the primary object. The result claims an id
 * whose other fields belong to a different booking. `booking_number` is not in
 * the broadcast payload, so a spliced object keeps the WRONG one: when the
 * server's copy of the same id disagrees on it, the store object is discarded
 * and the fetched list is taken as authoritative. Fixing the hook is the real
 * repair; this just guarantees Home can never render a card that deep links to
 * one errand while describing another.
 */
export function mergeActiveBookings<
  T extends { id: string; booking_number?: string },
>(
  primary: T | null | undefined,
  list: readonly T[] | null | undefined,
  cap: number = MAX_ACTIVE_CARDS,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();

  const twin = primary ? (list ?? []).find((b) => b?.id === primary.id) : null;
  const primaryIsTrustworthy =
    !twin ||
    !twin.booking_number ||
    !primary?.booking_number ||
    twin.booking_number === primary.booking_number;

  const push = (booking: T | null | undefined) => {
    if (!booking?.id || seen.has(booking.id)) return;
    if (out.length >= cap) return;
    seen.add(booking.id);
    out.push(booking);
  };

  // Primary first, so the object the realtime channel heals is the one that
  // renders; `seen` then makes the list's (possibly staler) copy of the same
  // booking a no-op.
  if (primaryIsTrustworthy) push(primary);
  for (const booking of list ?? []) push(booking);

  return out;
}
