import type { Booking } from '../../../types';
import { formatCurrency } from '../../../utils/formatCurrency';

/**
 * Copy for a GCash/Maya errand that is still waiting for its payment
 * (utils/bookingPayment's isAwaitingPayment). Shared by the home card and the
 * tracking screen so the two say the same specific thing.
 *
 * Wording only: whether the booking IS awaiting payment, and the checkout to
 * reopen, stay with utils/bookingPayment and useCompleteBookingPayment.
 */

const ONLINE_NAMES: Record<string, string> = { gcash: 'GCash', maya: 'Maya', paymaya: 'Maya' };

/** "GCash" / "Maya" for an online method, null for anything else. */
export function onlinePaymentName(method: string | null | undefined): string | null {
  return ONLINE_NAMES[(method ?? '').toLowerCase()] ?? null;
}

/**
 * The specific headline — "Waiting for your GCash payment" — falling back to
 * the generic "Waiting for your payment" when the method is unknown.
 */
export function awaitingPaymentHeadline(booking: Pick<Booking, 'payment_method'>): string {
  const name = onlinePaymentName(booking.payment_method);
  return name ? `Waiting for your ${name} payment` : 'Waiting for your payment';
}

/** The pay button's label: "Pay ₱95.00". */
export function payNowLabel(booking: Pick<Booking, 'total_amount'>): string {
  return `Pay ${formatCurrency(booking.total_amount)}`;
}
