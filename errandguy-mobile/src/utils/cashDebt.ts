import { formatCurrency } from './formatCurrency';

/**
 * The server's default for `runner_cash_debt_limit` (CashDebtPolicy::limit).
 * Only a fallback now: the real value rides the runner's own profile and
 * GET /wallet/balance as `cash_debt_limit` (see cashDebtLimit). This is what
 * an older server, which sends neither, is assumed to use.
 */
export const CASH_DEBT_LIMIT_FALLBACK = 1000;

/**
 * The cash-debt limit staff have set, read off a payload that carries it (the
 * runner's own profile, or the wallet summary from GET /wallet/balance), else
 * the fallback. 0 is kept: it means the limit is switched off.
 */
export function cashDebtLimit(source?: unknown): number {
  const raw = (source as { cash_debt_limit?: unknown } | null | undefined)?.cash_debt_limit;
  if (raw == null || raw === '') return CASH_DEBT_LIMIT_FALLBACK;
  const limit = Number(raw);
  return Number.isFinite(limit) && limit >= 0 ? limit : CASH_DEBT_LIMIT_FALLBACK;
}

/** "₱1,000" for a whole-peso limit, "₱1,000.50" otherwise — as the server prints it. */
const formatLimit = (limit: number) =>
  Number.isInteger(limit) ? `₱${limit.toLocaleString('en-PH')}` : formatCurrency(limit);

/**
 * The one sentence for money owed from cash errands, word for word what the
 * server says (CashDebtPolicy::message) on the accept refusal, the profile's
 * cash_debt_block, a payout request and an account-deletion refusal — so the
 * app never tells a runner a different story ("settle at least…", "nothing to
 * pay separately") than the API does.
 *
 * Prefer the server's own `message` wherever a response carries one; this is
 * for the screens that only have the balance. Pass the limit the server sent
 * (cashDebtLimit) so the pause point named is the one staff set.
 */
export function cashDebtMessage(owed: number, limit: number = CASH_DEBT_LIMIT_FALLBACK): string {
  const sentence = `You owe ${formatCurrency(Math.abs(owed))} from cash errands. It’s cleared automatically from your next prepaid earnings`;
  return limit > 0 ? `${sentence}; cash errands pause at ${formatLimit(limit)}.` : `${sentence}.`;
}

/**
 * The cash-debt sentence for a runner screen: the server's own
 * `cash_debt_block.message` when the profile carries one (it does once the
 * runner is over the limit), else the same sentence built from the balance
 * and the profile's `cash_debt_limit`.
 */
export function cashDebtText(owed: number, runnerProfile?: unknown): string {
  const block = (runnerProfile as { cash_debt_block?: { message?: unknown } | null } | null)
    ?.cash_debt_block;
  return typeof block?.message === 'string' && block.message
    ? block.message
    : cashDebtMessage(owed, cashDebtLimit(runnerProfile));
}
