import type { WalletSummary } from '../types';
import { formatCurrency } from './formatCurrency';

/**
 * The customer withdrawal minimum when the server doesn't say. Mirrors the
 * server's customer payout minimum (₱100); GET /wallet/balance sends the live
 * figure as `withdraw_min`, which always wins.
 */
export const DEFAULT_WITHDRAW_MIN = 100;

/** The smallest withdrawal the server will accept for this wallet. */
export function withdrawMinimum(summary: Pick<WalletSummary, 'withdraw_min'> | null | undefined): number {
  const min = summary?.withdraw_min;
  return typeof min === 'number' && Number.isFinite(min) && min > 0 ? min : DEFAULT_WITHDRAW_MIN;
}

/**
 * Why this amount can't be withdrawn, or null when it can. Checked before the
 * confirm dialog so a ₱50 withdrawal isn't sent only to be refused with
 * PAYOUT_MIN_AMOUNT (the old floor here was ₱1, which the server never took).
 */
export function withdrawAmountProblem(
  amount: number,
  withdrawable: number | null,
  min: number,
): string | null {
  if (!(amount > 0)) return `Enter at least ${formatCurrency(min)} to withdraw.`;
  if (amount < min) return `The minimum withdrawal is ${formatCurrency(min)}.`;
  if (withdrawable != null && amount > withdrawable) {
    return `That's more than the ${formatCurrency(withdrawable)} you can withdraw.`;
  }
  return null;
}
