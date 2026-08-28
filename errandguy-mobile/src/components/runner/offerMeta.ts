import dayjs from 'dayjs';
import type { Booking } from '../../types';

/**
 * Runner-facing offer metadata — the decision-critical facts a runner needs
 * BEFORE accepting, read tolerantly off whatever payload we happen to hold.
 *
 * WHY the cast instead of widening `Booking`:
 *   `payment_method_type`, `amount_to_collect`, `distance_to_pickup_km` and
 *   `accept_deadline` are RUNNER-GATED fields that BookingResource only emits
 *   for runner/admin viewers, and the Reverb offer projection
 *   (App\Events\IncomingRequest::broadcastWith) does not carry them at all.
 *   So an offer can legitimately arrive without them — from the realtime
 *   channel, from an older SWR cache entry, or from an endpoint that hasn't
 *   been refetched yet. Every reader here degrades to "not shown" rather than
 *   rendering a wrong number. Mirrors the same tolerant-cast idiom already
 *   used by the runner cockpit's cash strip.
 *
 * Everything in this module is DISPLAY ONLY — it reads out decisions the
 * server already made and changes no settlement behaviour.
 */
export type RunnerOpsBooking = Booking & {
  payment_method_type?: string | null;
  amount_to_collect?: number | string | null;
  distance_to_pickup_km?: number | string | null;
  accept_deadline?: string | null;
};

/** Client-side default when the server gives us no real deadline. */
export const DEFAULT_OFFER_TIMEOUT_SECONDS = 30;
/**
 * Clamp bounds for a server deadline. The floor keeps a skewed device clock
 * from slamming a still-valid offer shut the instant it appears; the ceiling
 * stops a bad timestamp from parking a modal on screen forever.
 */
export const MIN_OFFER_TIMEOUT_SECONDS = 5;
export const MAX_OFFER_TIMEOUT_SECONDS = 180;

function positiveNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Peso total the runner collects in person, or null when there's nothing. */
export function readAmountToCollect(booking: Booking): number | null {
  return positiveNumber((booking as RunnerOpsBooking).amount_to_collect);
}

/** 'cash' | 'wallet' | 'gcash' | 'maya' | 'card' | … or null when unknown. */
export function readPaymentMethodType(booking: Booking): string | null {
  const raw = (booking as RunnerOpsBooking).payment_method_type;
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  // Fall back to the plain column the customer-facing resource already sends —
  // same value, just not runner-gated.
  const legacy = booking.payment_method;
  return typeof legacy === 'string' && legacy.trim() !== '' ? legacy.trim() : null;
}

/**
 * Server-measured km from the runner's last GPS ping to this pickup. Attached
 * by RunnerErrandController to the offer feed and the matched offer. Treat as
 * APPROXIMATE — the ping can be a few minutes old; a live client fix always wins.
 */
export function readServerPickupKm(booking: Booking): number | null {
  return positiveNumber((booking as RunnerOpsBooking).distance_to_pickup_km);
}

/** ISO instant the server stops honouring this runner's accept, if known. */
export function readAcceptDeadline(booking: Booking): string | null {
  const raw = (booking as RunnerOpsBooking).accept_deadline;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  wallet: 'Wallet',
  gcash: 'GCash',
  maya: 'Maya',
  paymaya: 'Maya',
  card: 'Card',
  grab_pay: 'GrabPay',
  grabpay: 'GrabPay',
};

/** Human label for a payment method type, or null when we don't know it. */
export function paymentMethodLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  const key = type.toLowerCase();
  if (PAYMENT_LABELS[key]) return PAYMENT_LABELS[key];
  // Unknown gateway — title-case it rather than hiding the fact entirely.
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

/**
 * Seconds left on a matched offer, derived from the SERVER's deadline.
 *
 * The app used to hard-code 30s while the server honours
 * `matched_acceptance_timeout_seconds` (default 90s), so the offer vanished a
 * full minute before the server stopped taking the accept. Prefer the real
 * deadline; fall back to the old constant only when the payload has none.
 */
export function offerTimeoutSeconds(
  deadline: string | null | undefined,
  opts?: { now?: number; fallback?: number },
): number {
  const fallback = opts?.fallback ?? DEFAULT_OFFER_TIMEOUT_SECONDS;
  if (!deadline) return fallback;
  const at = Date.parse(deadline);
  if (!Number.isFinite(at)) return fallback;
  const secs = Math.ceil((at - (opts?.now ?? Date.now())) / 1000);
  if (secs <= 0) return MIN_OFFER_TIMEOUT_SECONDS;
  return Math.min(MAX_OFFER_TIMEOUT_SECONDS, Math.max(MIN_OFFER_TIMEOUT_SECONDS, secs));
}

/** Absolute expiry epoch-ms for the store's `incomingRequest.expiresAt`. */
export function offerExpiresAt(
  deadline: string | null | undefined,
  opts?: { now?: number; fallback?: number },
): number {
  const now = opts?.now ?? Date.now();
  return now + offerTimeoutSeconds(deadline, { now, fallback: opts?.fallback }) * 1000;
}

/** "today" / "tomorrow" / "Friday" / "Sep 3" for a scheduled window. */
function scheduleDayWord(at: string): string {
  const day = dayjs(at).startOf('day');
  const diff = day.diff(dayjs().startOf('day'), 'day');
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff > 1 && diff < 7) return day.format('dddd');
  return day.format('MMM D');
}

/**
 * "Scheduled · today 3:00 PM" for a scheduled booking, else null.
 * A runner accepting a T-15min scheduled job believing it was immediate is a
 * no-show waiting to happen, so every offer surface has to say so.
 */
export function scheduledOfferLabel(booking: Booking): string | null {
  if (booking.schedule_type !== 'scheduled' || !booking.scheduled_at) return null;
  const at = dayjs(booking.scheduled_at);
  if (!at.isValid()) return null;
  return `Scheduled · ${scheduleDayWord(booking.scheduled_at)} ${at.format('h:mm A')}`;
}

/** Count of extra destinations beyond the primary dropoff (0 when absent). */
export function extraStopCount(booking: Booking): number {
  return Array.isArray(booking.stops) ? booking.stops.length : 0;
}
