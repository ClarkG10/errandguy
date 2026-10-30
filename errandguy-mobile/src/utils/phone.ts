/**
 * Philippine mobile numbers, in the one shape the app SENDS: +639XXXXXXXXX.
 *
 * People type a PH mobile number every way there is — 09171234567,
 * +63 917 123 4567, 63917…, 917-123-4567 — and the contact picker hands back
 * the same mix. The server used to receive whatever was typed, so one person's
 * number could sit on file as "0917…" in one row and "+63917…" in another, and
 * signing in by phone only worked if it was typed the way it was first saved.
 * Every request body that carries a mobile number (sign-up, sign-in by phone,
 * profile, trusted contacts, errand contacts, GCash/Maya payout numbers) goes
 * through `phoneForApi` so the server only ever sees E.164.
 *
 * Same acceptance rule as App\Support\PhilippinePhone::normalize on the server
 * (which emits 09… for the SMS provider): an optional +63 / 63 / 0 prefix, then
 * 9 and nine more digits, with spaces, dashes, dots or brackets ignored.
 */

const SEPARATORS = /[\s\-().]/g;
const PH_MOBILE = /^(?:\+?63|0)?(9\d{9})$/;

/** The ten subscriber digits ("9171234567"), or null when it isn't a PH mobile. */
function subscriberDigits(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const match = PH_MOBILE.exec(raw.trim().replace(SEPARATORS, ''));
  return match ? match[1] : null;
}

/** "+639171234567" for any accepted spelling of a PH mobile number, else null. */
export function toPhMobileE164(raw: string | null | undefined): string | null {
  const digits = subscriberDigits(raw);
  return digits ? `+63${digits}` : null;
}

/** "09171234567" for any accepted spelling of a PH mobile number, else null. */
export function toPhMobileLocal(raw: string | null | undefined): string | null {
  const digits = subscriberDigits(raw);
  return digits ? `0${digits}` : null;
}

export function isPhMobile(raw: string | null | undefined): boolean {
  return subscriberDigits(raw) !== null;
}

/**
 * The number as it should go into a request body: E.164 when it is a PH
 * mobile number. Anything else — blank, null, a typo — is passed through
 * untouched, so the server's own validation is what explains the problem
 * instead of the app silently swapping in something the person never typed.
 */
export function phoneForApi<T extends string | null | undefined>(raw: T): T | string {
  return toPhMobileE164(raw) ?? raw;
}

/** "0917 123 4567" for display; anything unrecognised is shown as stored. */
export function formatPhMobile(raw: string | null | undefined): string {
  const local = toPhMobileLocal(raw);
  if (!local) return raw ?? '';
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
