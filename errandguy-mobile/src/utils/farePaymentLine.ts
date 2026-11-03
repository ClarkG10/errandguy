import type { Booking } from '../types';
import { isAwaitingPayment } from './bookingPayment';

type FareFields = Pick<Booking, 'status' | 'payment_method'> &
  Partial<Pick<Booking, 'awaiting_payment'>>;

const ONLINE_NAMES: Record<string, string> = { gcash: 'GCash', maya: 'Maya', paymaya: 'Maya' };

/**
 * How the errand fare is paid, in the customer's words, for the fare row on
 * tracking: "Pay the runner in cash", "Paid with GCash", "Paid from wallet".
 *
 * Honest about an online payment that hasn't landed: a GCash/Maya booking
 * still waiting for its payment says so, and is never called paid. Null when
 * the method is unknown, so the row shows the amount alone.
 */
export function farePaymentLine(booking: FareFields): string | null {
  const method = booking.payment_method?.toLowerCase();
  if (!method) return null;
  if (method === 'cash') {
    return booking.status === 'completed' ? 'Paid to the runner in cash' : 'Pay the runner in cash';
  }
  if (method === 'wallet') return 'Paid from wallet';
  const online = ONLINE_NAMES[method];
  if (!online) return null;
  return isAwaitingPayment(booking) ? `Waiting for your ${online} payment` : `Paid with ${online}`;
}
