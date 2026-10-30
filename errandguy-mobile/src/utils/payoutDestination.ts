import type { PayoutChannel } from '../types';
import { isPhMobile, phoneForApi } from './phone';

/**
 * Where money goes out to — a customer's withdrawal, a runner's payout method,
 * or the balance of an account being deleted. Mirrors App\Support\
 * PayoutDestination: the same four fields everywhere (channel, account_number,
 * account_name, and bank_name for a bank), checked the way the server checks
 * them so a mistake is caught before the request, not by a 422 after it.
 */
export interface PayoutDestinationDraft {
  channel: PayoutChannel | null;
  accountNumber: string;
  accountName: string;
  /** Bank only. */
  bankName: string;
}

export interface PayoutDestinationPayload {
  channel: PayoutChannel;
  account_number: string;
  account_name: string;
  bank_name?: string;
}

export type PayoutDestinationErrors = Partial<
  Record<'channel' | 'account_number' | 'account_name' | 'bank_name', string>
>;

export const EMPTY_PAYOUT_DESTINATION: PayoutDestinationDraft = {
  channel: null,
  accountNumber: '',
  accountName: '',
  bankName: '',
};

export const PAYOUT_CHANNEL_LABELS: Record<PayoutChannel, string> = {
  gcash: 'GCash',
  maya: 'Maya',
  bank: 'Bank account',
};

/**
 * Philippine banks staff can send to, named exactly as the server's
 * PayoutDestination::CHANNEL_CODES does — so a picked bank resolves to its
 * Xendit channel on its own. Free text routed real payouts into manual admin
 * fixes ("BDo", "bpi savings", "Metro bank"), so this is a picker and `Other`
 * is the only typed escape.
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
  'China Bank',
  'EastWest',
] as const;

export const OTHER_BANK = 'Other';

/** The picker option for a saved bank name (case-insensitive), or null. */
export function knownBank(name: string | null | undefined): string | null {
  const v = (name ?? '').trim().toLowerCase();
  return PH_BANKS.find((b) => b.toLowerCase() === v) ?? null;
}

/** "0917 123-4567" → "09171234567" before it is normalised for the request. */
const compactMobile = (v: string) => v.replace(/[\s-]/g, '');
const digitsOnly = (v: string) => v.replace(/\D/g, '');

export const isEwalletChannel = (c: PayoutChannel | null): c is 'gcash' | 'maya' =>
  c === 'gcash' || c === 'maya';

/**
 * Check a draft the way the server will. Empty when it would be accepted.
 * `channels` is what this flow allows (customers withdraw to GCash or Maya
 * only; a runner's payout method and a runner's deletion can also use a bank).
 */
export function validatePayoutDestination(
  d: PayoutDestinationDraft,
  channels: readonly PayoutChannel[],
): PayoutDestinationErrors {
  const errors: PayoutDestinationErrors = {};
  if (!d.channel || !channels.includes(d.channel)) {
    errors.channel = channels.includes('bank')
      ? 'Choose where to send the money: GCash, Maya or a bank account.'
      : 'Choose where to send the money: GCash or Maya.';
    return errors;
  }
  if (isEwalletChannel(d.channel)) {
    if (!isPhMobile(d.accountNumber)) {
      errors.account_number = `Enter the ${PAYOUT_CHANNEL_LABELS[d.channel]} mobile number, e.g. 09171234567.`;
    }
  } else {
    const digits = digitsOnly(d.accountNumber);
    if (digits.length < 6 || digits.length > 20) {
      errors.account_number = 'Enter the bank account number (6–20 digits).';
    }
    const bank = d.bankName.trim();
    if (!bank) errors.bank_name = 'Choose the bank, or type its name.';
    else if (bank.length > 100) errors.bank_name = 'That bank name is too long.';
  }
  const name = d.accountName.trim();
  if (!name) errors.account_name = 'Enter the account holder’s name.';
  else if (name.length > 100) errors.account_name = 'That name is too long.';
  return errors;
}

/** The request body for a valid draft (validate first). */
export function toPayoutDestinationPayload(d: PayoutDestinationDraft): PayoutDestinationPayload {
  const channel = d.channel as PayoutChannel;
  if (channel === 'bank') {
    return {
      channel,
      account_number: digitsOnly(d.accountNumber),
      account_name: d.accountName.trim(),
      bank_name: d.bankName.trim(),
    };
  }
  return {
    channel,
    // E.164 (+639…), like every other mobile number the app sends.
    account_number: phoneForApi(compactMobile(d.accountNumber)),
    account_name: d.accountName.trim(),
  };
}

/**
 * The server's field errors (422 `errors`: field → [messages]) as one message
 * per field, for showing under the inputs.
 */
export function payoutDestinationServerErrors(err: unknown): PayoutDestinationErrors {
  const raw = (err as { errors?: Record<string, unknown> } | null)?.errors ?? {};
  const out: PayoutDestinationErrors = {};
  for (const field of ['channel', 'account_number', 'account_name', 'bank_name'] as const) {
    const v = raw[field];
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === 'string' && first) out[field] = first;
  }
  return out;
}

/** "GCash •••• 4567" — never more than the last four digits, like the server's label. */
export function maskedDestination(
  channel: PayoutChannel | null | undefined,
  accountNumber: string | null | undefined,
  bankName?: string | null,
): string | null {
  const last4 = digitsOnly(accountNumber ?? '').slice(-4);
  if (!channel || !last4) return null;
  const name = channel === 'bank' ? (bankName?.trim() || 'Bank account') : PAYOUT_CHANNEL_LABELS[channel];
  return `${name} •••• ${last4}`;
}
