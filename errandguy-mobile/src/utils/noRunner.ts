import type { Booking } from '../types';
import { formatCurrency } from './formatCurrency';

/**
 * What a customer can do about an errand no runner took.
 *
 * "Search again" (POST /bookings/{id}/retry-match) only works while the server
 * still holds the errand's money, or never needed it (cash). A prepaid errand
 * is refunded to the ErrandGuy wallet the moment it goes `no_runner`, so
 * searching again would run it for free: the server refuses (409
 * RETRY_NOT_ALLOWED) and says so up front with BookingResource
 * `can_retry_match`. The way forward then is a fresh booking — "Book again" —
 * and the copy must say where the money went, not offer a button that can
 * only ever fail.
 */

type NoRunnerFields = Partial<Pick<Booking, 'can_retry_match' | 'refunded_amount'>>;

/**
 * Would "Search again" be accepted? Only an explicit `false` says no: an older
 * server sends no flag, and there the button behaves as it always did (the
 * server still refuses with its own message if it must).
 */
export function canRetryMatch(booking: NoRunnerFields | null | undefined): boolean {
  return booking?.can_retry_match !== false;
}

/** The peso amount returned to the wallet on this errand, or 0. */
export function refundedToWallet(booking: NoRunnerFields | null | undefined): number {
  const raw = booking?.refunded_amount;
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The line under "No runners available" once searching again is off the
 * table. Names the amount and where it went when the errand was refunded.
 */
export function noRunnerRebookLine(booking: NoRunnerFields | null | undefined): string {
  const refunded = refundedToWallet(booking);
  return refunded > 0
    ? `No runner took this errand, so your ${formatCurrency(refunded)} went back to your ErrandGuy wallet. Book it again to find a runner.`
    : 'This errand can’t be searched again. Book it again to find a runner.';
}
