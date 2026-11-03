import type { Booking } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRunnerPayout } from '../../utils/runnerPayout';
import { readPaymentMethodType } from './offerMeta';

/**
 * What a runner actually got from an errand in their history — DISPLAY ONLY.
 *
 * A cancelled errand still carries the `runner_payout` it WOULD have paid, and
 * Home's "Recent" and the History list printed that figure beside the word
 * "Cancelled", as if it had been earned. What a cancelled errand really paid
 * is the cancellation fee: the server records it on the booking
 * (`cancellation_fee`) and credits exactly that to the runner who had accepted
 * it (BookingController::cancel → WalletService::creditCancellationFee).
 * Nothing at all when no fee applied.
 */
export function cancelFeeEarned(errand: Pick<Booking, 'cancellation_fee'>): number {
  const fee = Number(errand.cancellation_fee ?? 0);
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

/** "₱85.00" for a completed errand, "₱20.00" / "₱0.00" for a cancelled one. */
export function earnedLabel(
  errand: Pick<Booking, 'status' | 'runner_payout' | 'cancellation_fee'>,
): string {
  if (errand.status === 'cancelled') return formatCurrency(cancelFeeEarned(errand));
  return formatRunnerPayout(errand.runner_payout);
}

/**
 * How a completed errand paid the runner: on a CASH errand they collected the
 * fare at the door (the payout is already in their pocket), otherwise it was
 * paid online and their payout goes to the wallet. Null when the payload
 * doesn't say — never a guess.
 */
export function settledIn(errand: Booking): 'cash' | 'online' | null {
  const method = readPaymentMethodType(errand);
  if (!method) return null;
  return method.toLowerCase() === 'cash' ? 'cash' : 'online';
}

/**
 * The hero's period total split into cash already in hand vs money going to
 * the wallet, from the per-errand rows. Returns null unless the rows add up to
 * the server's own total (to the centavo) and every row says how it was paid —
 * a truncated page, a stale cache or an older row must hide the split, never
 * show one that disagrees with the number above it.
 */
export function splitEarnings(
  rows: Booking[],
  serverTotal: number | null | undefined,
): { cash: number; wallet: number } | null {
  if (!rows.length || serverTotal == null) return null;
  let cash = 0;
  let wallet = 0;
  for (const row of rows) {
    const how = settledIn(row);
    if (!how) return null;
    const pay = Number(row.runner_payout ?? 0);
    if (!Number.isFinite(pay)) return null;
    if (how === 'cash') cash += pay;
    else wallet += pay;
  }
  const cents = (n: number) => Math.round(n * 100);
  if (cents(cash) + cents(wallet) !== cents(Number(serverTotal))) return null;
  return { cash: cents(cash) / 100, wallet: cents(wallet) / 100 };
}
