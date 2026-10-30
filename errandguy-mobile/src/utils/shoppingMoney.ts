import type { Booking, ErrandType } from '../types';
import { formatCurrency } from './formatCurrency';

/**
 * Item money on a shopping errand ("Buy for me", and the legacy food /
 * grocery / bill errands still in progress).
 *
 * The runner pays for the items with their own cash, and the customer repays
 * the receipt amount IN CASH at the door, never more than the budget they set.
 * Nothing for items is charged online, so there is no hold on the budget and
 * no unspent remainder to give back: every item line the customer sees is
 * cash they hand over in person.
 */

/** Budget ceiling when the catalog doesn't send one (an older server). */
export const DEFAULT_SHOPPING_BUDGET_MAX = 3000;

/** The highest items budget this errand type allows. */
export function shoppingBudgetMax(
  type: Pick<ErrandType, 'shopping_budget_max'> | null | undefined,
): number {
  const raw = type?.shopping_budget_max;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SHOPPING_BUDGET_MAX;
}

/** Validation copy for an items budget, or null when it is acceptable. */
export function shoppingBudgetError(
  budget: number | null | undefined,
  max: number,
): string | null {
  if (budget == null || !Number.isFinite(budget) || budget <= 0) {
    return 'Shopping budget is required';
  }
  if (budget > max) {
    return `The budget can be at most ${formatCurrency(max)}, since your runner pays for the items with their own cash.`;
  }
  return null;
}

const positive = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Cash the customer owes for the items, or null before the runner has bought
 * them. Prefers the server's `items_cash_due`; an older server doesn't send
 * it, and there `actual_item_cost` is the same figure.
 */
export function itemsCashDue(
  booking: Pick<Booking, 'actual_item_cost'> & Partial<Pick<Booking, 'items_cash_due'>>,
): number | null {
  return 'items_cash_due' in booking
    ? positive(booking.items_cash_due)
    : positive(booking.actual_item_cost);
}

/**
 * The one line telling the customer what cash to have ready for the items:
 * the exact amount once the runner has bought them, the budget as a ceiling
 * before that. Null when there is neither (not a shopping errand).
 */
export function itemsCashReadyLine(
  booking: Pick<Booking, 'actual_item_cost' | 'shopping_budget'> &
    Partial<Pick<Booking, 'items_cash_due'>>,
): string | null {
  const due = itemsCashDue(booking);
  if (due != null) {
    return due > 0
      ? `Have ${formatCurrency(due)} cash ready for the items`
      : 'No cash needed for the items';
  }
  const budget = positive(booking.shopping_budget);
  return budget != null && budget > 0
    ? `Have up to ${formatCurrency(budget)} cash ready for the items`
    : null;
}
