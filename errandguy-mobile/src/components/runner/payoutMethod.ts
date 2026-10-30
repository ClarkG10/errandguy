import type { PayoutChannel, RunnerProfile } from '../../types';
import { PAYOUT_CHANNEL_LABELS } from '../../utils/payoutDestination';

/**
 * Payout-method truth shared by the runner payout screen and the earnings
 * tab's money strip.
 *
 * Everything here MIRRORS RunnerProfile::payoutDestination() on the server —
 * it never relaxes it. The server stays the authority; the point is only to
 * tell the runner what is missing BEFORE they type an amount, tap Request,
 * confirm a modal and finally eat a PAYOUT_METHOD_REQUIRED rejection.
 */

/**
 * Fields RunnerProfileResource returns for the runner's OWN profile that the
 * shared `RunnerProfile` type does not declare.
 */
export interface SelfRunnerProfile extends RunnerProfile {
  /** Last 4 digits of the saved bank account, computed at read; never stored.
   *  Null when nothing is on file — or when a legacy plaintext row can't be
   *  decrypted (see the model accessor), which is why a bank whose last4 is
   *  missing is treated as "re-enter it", not as a hard error. */
  bank_account_last4?: string | null;
  /** SystemConfig `min_payout_amount`. The app used to hardcode ₱100. */
  payout_minimum?: number | null;
  /** Saved through PUT /runner/payout-method. Null for a method saved by an
   *  older app build, which never said which e-wallet a number belongs to. */
  payout_channel?: PayoutChannel | null;
  payout_account_name?: string | null;
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

export type PayoutBlocker =
  /** Nothing sendable on file — the server rejects outright. */
  | 'no_method'
  /** A bank name with no account number we can see — the server rejects a
   *  bank payout without both halves. */
  | 'incomplete_bank';

export interface PayoutMethodState {
  /** A payout can actually be requested right now. */
  ready: boolean;
  /** Null when ready; otherwise what to tell the runner up front. */
  blocker: PayoutBlocker | null;
  /** gcash | maya | bank — null for an e-wallet number an older build saved
   *  without saying which (staff then pick GCash or Maya when sending). */
  channel: PayoutChannel | null;
  /** Where the money will actually land: "GCash •••• 4567", "BDO •••• 1234",
   *  "E-wallet •••• 4567". Null when nothing sendable is saved. */
  label: string | null;
  accountName: string | null;
  bankName: string | null;
  /** The saved e-wallet number doesn't say GCash or Maya yet. */
  needsChannel: boolean;
}

const trimmed = (v: string | null | undefined): string => (v ?? '').trim();
const last4 = (v: string) => v.replace(/\D/g, '').slice(-4);

export function resolvePayoutMethod(
  profile: SelfRunnerProfile | null | undefined,
): PayoutMethodState {
  const channel = profile?.payout_channel ?? null;
  const ewallet = trimmed(profile?.ewallet_number);
  const bankName = trimmed(profile?.bank_name) || null;
  const bankLast4 = trimmed(profile?.bank_account_last4) || null;
  const bankReady = bankName !== null && bankLast4 !== null;
  const accountName = trimmed(profile?.payout_account_name) || null;

  const ewalletState = (c: 'gcash' | 'maya' | null): PayoutMethodState => ({
    ready: true,
    blocker: null,
    channel: c,
    label: `${c ? PAYOUT_CHANNEL_LABELS[c] : 'E-wallet'} •••• ${last4(ewallet)}`,
    accountName,
    bankName: null,
    needsChannel: c === null,
  });
  const bankState: PayoutMethodState = {
    ready: true,
    blocker: null,
    channel: 'bank',
    label: `${bankName} •••• ${bankLast4}`,
    accountName,
    bankName,
    needsChannel: false,
  };
  const notReady = (blocker: PayoutBlocker): PayoutMethodState => ({
    ready: false,
    blocker,
    channel,
    label: null,
    accountName,
    bankName,
    needsChannel: false,
  });

  // An explicit method is used exactly as saved.
  if (channel === 'gcash' || channel === 'maya') {
    return ewallet ? ewalletState(channel) : notReady('no_method');
  }
  if (channel === 'bank') {
    return bankReady ? bankState : notReady(bankName ? 'incomplete_bank' : 'no_method');
  }
  // Saved by an older build: the e-wallet number wins over a bank account, as
  // it always has on the server.
  if (ewallet) return ewalletState(null);
  if (bankReady) return bankState;
  return notReady(bankName ? 'incomplete_bank' : 'no_method');
}
