import { formatCurrency } from './formatCurrency';

/**
 * Formats a runner's take-home for an errand — or a neutral placeholder
 * when the payout isn't known yet.
 *
 * IMPORTANT: this deliberately does NOT fall back to `total_amount`.
 * `total_amount` is the *customer's* full charge (delivery fee + item
 * budget + platform fee); presenting it as the runner's payout massively
 * overstates earnings on shopping errands, where the item budget dominates.
 * Runner-facing surfaces must mirror the errand detail screen's payout
 * strip, which shows "Payout pending" until `runner_payout` is computed
 * (see src/app/(runner)/errand/[id].tsx).
 *
 * @param payout        the errand's `runner_payout` (number | null | undefined)
 * @param pendingLabel  what to show when payout is unknown (default "Payout pending")
 */
export function formatRunnerPayout(
  payout: number | null | undefined,
  pendingLabel = 'Payout pending',
): string {
  return payout != null ? formatCurrency(payout) : pendingLabel;
}
