import type { RunnerProfile } from '../../types';

/**
 * Payout-method truth shared by the runner payout screen and the earnings
 * tab's money strip.
 *
 * Everything here MIRRORS RunnerPayoutController::requestPayout — it never
 * relaxes it. The server stays the authority; the point is only to tell the
 * runner what is missing BEFORE they type an amount, tap Request, confirm a
 * modal and finally eat a PAYOUT_METHOD_REQUIRED rejection.
 */

/**
 * Fields RunnerProfileResource returns for the runner's OWN profile that the
 * shared `RunnerProfile` type does not declare yet (`bank_account_last4`,
 * `payout_minimum`). Declared locally so these screens stay strict-clean
 * without editing src/types/runner.ts (owned elsewhere this wave).
 */
export interface SelfRunnerProfile extends RunnerProfile {
  /** Last 4 digits of the saved bank account, computed at read; never stored.
   *  Null when nothing is on file — or when a legacy plaintext row can't be
   *  decrypted (see the model accessor), which is why a bank whose last4 is
   *  missing is treated as "re-enter it", not as a hard error. */
  bank_account_last4?: string | null;
  /** SystemConfig `min_payout_amount`. The app used to hardcode ₱100. */
  payout_minimum?: number | null;
}

/** Same fallback the server uses when SystemConfig has no row. */
export const PAYOUT_MIN_FALLBACK = 100;

/**
 * The payout floor the Request button is really gated on. Falls back to ₱100
 * (never 0 — a 0 floor would un-gate the button and produce server 422s).
 */
export function payoutMinimum(profile: SelfRunnerProfile | null | undefined): number {
  const raw = Number(profile?.payout_minimum);
  return Number.isFinite(raw) && raw > 0 ? raw : PAYOUT_MIN_FALLBACK;
}

/**
 * Philippine banks that actually appear in runner payouts. Free text here used
 * to route real money into manual admin fixes ("BDo", "bpi savings", "Metro
 * bank"), so the picker is the input and `Other` is the only typed escape.
 */
export const PH_BANKS = [
  'BDO',
  'BPI',
  'Metrobank',
  'Landbank',
  'UnionBank',
  'PNB',
  'RCBC',
  'Security Bank',
  'Chinabank',
  'EastWest',
] as const;

export const OTHER_BANK = 'Other';

/** True when `name` is one of the picker's fixed options. */
export function isKnownBank(name: string | null | undefined): boolean {
  const v = (name ?? '').trim();
  return PH_BANKS.some((b) => b.toLowerCase() === v.toLowerCase());
}

export type PayoutBlocker =
  /** Nothing at all on file — the server rejects outright. */
  | 'no_method'
  /** A bank name with no account number we can see — the server rejects a
   *  bank payout without both halves. */
  | 'incomplete_bank';

export interface PayoutMethodState {
  hasEwallet: boolean;
  hasBankName: boolean;
  /** We can SEE an account number on file (last4 present). */
  hasBankAccount: boolean;
  /** A payout can actually be requested right now. */
  ready: boolean;
  /** Null when ready; otherwise what to tell the runner up front. */
  blocker: PayoutBlocker | null;
  bankLast4: string | null;
  bankName: string | null;
  /** Where the money will actually land — mirrors the server's own
   *  `ewallet_number ?: bank_account_number` resolution order. */
  destination: string | null;
}

const trimmed = (v: string | null | undefined): string => (v ?? '').trim();

export function resolvePayoutMethod(
  profile: SelfRunnerProfile | null | undefined,
): PayoutMethodState {
  const bankName = trimmed(profile?.bank_name) || null;
  const bankLast4 = trimmed(profile?.bank_account_last4) || null;
  const hasEwallet = trimmed(profile?.ewallet_number).length > 0;
  const hasBankName = bankName !== null;
  const hasBankAccount = bankLast4 !== null;
  // Server rule: an e-wallet number alone is sendable; a bank needs BOTH the
  // name and an account number.
  const ready = hasEwallet || (hasBankName && hasBankAccount);

  return {
    hasEwallet,
    hasBankName,
    hasBankAccount,
    ready,
    blocker: ready ? null : hasBankName ? 'incomplete_bank' : 'no_method',
    bankLast4,
    bankName,
    destination: hasEwallet
      ? 'your e-wallet'
      : hasBankName && hasBankAccount
        ? `your ${bankName} account`
        : null,
  };
}

/** "•••• 1234" — proof an account IS on file without ever showing the number. */
export function maskedAccount(last4: string | null | undefined): string | null {
  const v = trimmed(last4);
  return v ? `•••• ${v}` : null;
}
