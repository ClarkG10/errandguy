import type { Booking } from '../types';

/**
 * The GCash / Maya waiting room.
 *
 * An online-paid booking is not offered to any runner until its payment is
 * confirmed, and one still unpaid this many minutes after it was created is
 * cancelled by the server. Until then the honest headline is "Waiting for your
 * payment", never "Finding a runner": nobody is being looked for yet.
 *
 * Every reader tolerates an older server that sends none of these fields — a
 * booking without `awaiting_payment` simply reads as not waiting, which is
 * exactly how that server behaves.
 */
export const UNPAID_CHECKOUT_WINDOW_MINUTES = 15;

type PaymentFields = Pick<Booking, 'status'> &
  Partial<Pick<Booking, 'awaiting_payment' | 'checkout_url' | 'created_at'>>;

/** True while a GCash/Maya booking waits for its payment before matching. */
export function isAwaitingPayment(booking: PaymentFields | null | undefined): boolean {
  return !!booking && booking.status === 'pending' && booking.awaiting_payment === true;
}

/** The checkout to reopen for a booking that is still waiting for payment. */
export function bookingCheckoutUrl(booking: PaymentFields | null | undefined): string | null {
  if (!isAwaitingPayment(booking)) return null;
  const url = booking?.checkout_url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

/**
 * When an unpaid booking will be cancelled (epoch ms), or null when the
 * creation time is unknown. A clock time ("Pay by 3:42 PM") rather than a
 * countdown, so a phone clock a minute off never shows a wrong number.
 */
export function paymentDeadline(booking: PaymentFields | null | undefined): number | null {
  const created = booking?.created_at ? Date.parse(booking.created_at) : NaN;
  if (!Number.isFinite(created)) return null;
  return created + UNPAID_CHECKOUT_WINDOW_MINUTES * 60_000;
}

/** The server's structured code for a booking cancelled because it was never paid. */
export const PAYMENT_NOT_COMPLETED = 'payment_not_completed';

/**
 * Fallback only, for bookings the server cancelled before it sent
 * `cancellation_code`: the reasons it recorded then were "Checkout window
 * expired before payment was completed" and "Online payment was not
 * completed".
 */
const LEGACY_UNPAID_REASON =
  /payment\b.*?(?:\bnot\b|\bnever\b|n['’]t\b).*?\bcomplet|before payment was completed/i;

/** True when the server cancelled this booking because it was never paid. */
export function wasCancelledForUnpaidPayment(
  booking:
    | (PaymentFields & Partial<Pick<Booking, 'cancellation_reason' | 'cancellation_code'>>)
    | null
    | undefined,
): boolean {
  if (!booking || booking.status !== 'cancelled') return false;
  // The code is the contract; a server that sends it never needs the text.
  if (booking.cancellation_code !== undefined) {
    return booking.cancellation_code === PAYMENT_NOT_COMPLETED;
  }
  return LEGACY_UNPAID_REASON.test(booking.cancellation_reason ?? '');
}

export const UNPAID_CANCEL_TITLE = 'Payment not completed';

/** The plain explanation for an errand cancelled because it was never paid.
 *  The server only cancels one with no completed charge, so nothing was
 *  taken; on the new flow no runner was ever involved either. */
export function unpaidCancelMessage(
  booking: Partial<Pick<Booking, 'runner_id'>> | null | undefined,
): string {
  return booking?.runner_id
    ? "Your payment wasn't completed, so this errand was cancelled. You weren't charged."
    : "Your payment wasn't completed, so this errand was cancelled before any runner was sent. You weren't charged.";
}

/** The line under "Waiting for your payment": when it must be paid by. */
export function paymentDeadlineLine(
  booking: PaymentFields | null | undefined,
  formatTime: (ms: number) => string,
  now: number = Date.now(),
): string {
  const deadline = paymentDeadline(booking);
  return deadline != null && deadline > now
    ? `Pay by ${formatTime(deadline)}, or this errand is cancelled.`
    : `An errand left unpaid for ${UNPAID_CHECKOUT_WINDOW_MINUTES} minutes is cancelled.`;
}
