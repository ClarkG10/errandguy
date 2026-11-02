/**
 * Turns a normalized API error into honest, actionable copy — the general form
 * of `paymentErrors.ts`, extended to every domain.
 *
 * Two inputs decide the copy:
 *   • the backend machine `code` (e.g. `INSUFFICIENT_WALLET_BALANCE`), the
 *     single source of truth mirrored from the Laravel `ErrorCode` enum, and
 *   • the `kind` (offline/timeout/server/…) from `classifyError`, for whole
 *     CLASSES of failure the backend can't name individually.
 *
 * Resolution order (this is the key precedence change — code/kind lead, the raw
 * backend message is demoted to a mid-tier fallback):
 *   0. a refusal the server words for the refused action (SERVER_WORDED, or a
 *      caller's `trustServerMessageFor`) → its message, verbatim
 *   1. exact backend `code` in ERROR_CATALOG
 *   2. payment/gateway → delegate to `mapFailureReason` (one payment source)
 *   3. classes where the backend message is useless/generic → KIND_DEFAULTS
 *      (offline, timeout, server, auth, rate_limited, gateway)
 *   4. a trustworthy backend `message` (validation + specific 4xx)
 *   5. caller's domain fallback → generic unknown
 */
import { mapFailureReason } from './paymentErrors';
import type { ErrorKind } from './classifyError';

export interface ErrorInfo {
  title: string;
  message: string;
  retryable: boolean;
  /** Optional CTA hint a surface can wire to a route/action. */
  action?: { label: string; kind: 'signin' | 'retry' | 'contact' };
}

/** Backend `code` (UPPER_SNAKE, matches Laravel App\Support\ErrorCode) → copy.
 *  Only entries where we can say something better than the backend message.
 *
 *  Deliberately absent: the money codes whose server message is already the
 *  most specific thing to say — INSUFFICIENT_WALLET_BALANCE ("This booking
 *  costs ₱X but your wallet balance is ₱Y…"), PAYOUT_MIN_AMOUNT (names the
 *  minimum), CASH_DEBT_OUTSTANDING ("You owe ₱X from cash errands…") and
 *  PAYOUT_METHOD_REQUIRED (says what is missing). A fixed line here would
 *  overrule those amounts with something vaguer. */
export const ERROR_CATALOG: Record<string, ErrorInfo> = {
  BOOKING_CONFLICT: {
    title: 'You already have an errand',
    message: 'Finish or cancel your errand in progress before starting another.',
    retryable: false,
  },
  BOOKING_STALE: {
    title: 'This errand just changed',
    message: 'It was updated a moment ago. Pull to refresh and try again.',
    retryable: false,
  },
  BOOKING_STATE_INVALID: {
    title: "That step isn't available",
    message: 'This errand already moved on. Refresh to see its current status.',
    retryable: false,
  },
  NO_RUNNER_AVAILABLE: {
    title: 'No runners nearby',
    message: 'No runners are available right now. Please try again in a few minutes.',
    retryable: true,
  },
  ACCOUNT_SUSPENDED: {
    title: 'Account suspended',
    message: 'Your account is suspended. Contact support for help.',
    retryable: false,
    action: { label: 'Contact support', kind: 'contact' },
  },
  RUNNER_NOT_APPROVED: {
    title: 'Not approved yet',
    message: 'Your account must be approved before you can do that.',
    retryable: false,
  },
  DOCUMENT_REQUIRED: {
    title: 'Document needed',
    message: 'A required document is missing. Upload it to continue.',
    retryable: false,
  },
  OTP_MAX_ATTEMPTS: {
    title: 'Too many attempts',
    message: 'Too many incorrect codes. Request a new one to continue.',
    retryable: false,
  },
  OTP_EXPIRED: {
    title: 'Code expired',
    message: 'That code has expired. Request a new one to continue.',
    retryable: true,
  },
  OTP_INVALID: {
    title: 'Incorrect code',
    message: "That code isn't correct. Check it and try again.",
    retryable: true,
  },
  OTP_DELIVERY_FAILED: {
    title: "Couldn't send code",
    message: "We couldn't send your verification code right now. Try again in a moment.",
    retryable: true,
  },
  PASSWORD_RESET_DELIVERY_FAILED: {
    title: "Couldn't send email",
    message: "We couldn't send your reset email right now. Try again in a moment.",
    retryable: true,
  },
  INVALID_CREDENTIALS: {
    title: 'Sign-in failed',
    message: "That email or password doesn't match our records. Try again.",
    retryable: true,
  },
  ACCOUNT_INACTIVE: {
    title: 'Account not active',
    message: "Your account isn't active yet. Contact support if this seems wrong.",
    retryable: false,
    action: { label: 'Contact support', kind: 'contact' },
  },
  EMAIL_ALREADY_REGISTERED: {
    title: 'Email already in use',
    message: 'This email is already registered. Try signing in instead.',
    retryable: false,
    action: { label: 'Sign in', kind: 'signin' },
  },
  PHONE_ALREADY_REGISTERED: {
    title: 'Number already in use',
    message: 'This phone number is already registered. Try signing in instead.',
    retryable: false,
    action: { label: 'Sign in', kind: 'signin' },
  },
};

/**
 * Refusals the SERVER words for the one action that was refused — the copy is
 * its message, verbatim. Only the title (and a fallback for a server that sent
 * no message) lives here.
 *
 * These exist because the generic code they replace lied: a refused "Search
 * again" on an errand whose money was already refunded, and a runner's refused
 * accept (wrong vehicle for the errand, or their own errand), both came back as
 * BOOKING_CONFLICT — whose fixed copy is "You already have an errand. Finish or
 * cancel your errand in progress…" for a customer with no other errand at all.
 */
export const SERVER_WORDED: Record<string, ErrorInfo> = {
  // POST /bookings/{id}/retry-match refused: refunded, unpaid, scheduled…
  // (data.reason). The message says what happened and what to do instead.
  RETRY_NOT_ALLOWED: {
    title: "Can't search again",
    message: 'This errand can’t be searched again. Book it again to find a runner.',
    retryable: false,
  },
  // POST /runner/errands/{id}/accept refused for THIS runner: the errand needs
  // a different vehicle, or it is their own errand.
  ACCEPT_NOT_ALLOWED: {
    title: "Can't take this errand",
    message: 'You can’t accept this errand.',
    retryable: false,
  },
};

/**
 * The code an OLDER server used for those same action-worded refusals, before
 * RETRY_NOT_ALLOWED / ACCEPT_NOT_ALLOWED existed. Passed as
 * `trustServerMessageFor` at the retry-match and accept call sites only —
 * everywhere else BOOKING_CONFLICT really does mean "you have an errand in
 * progress", and its catalog copy stands.
 */
export const LEGACY_WORDED_REFUSALS: ReadonlyArray<string> = ['BOOKING_CONFLICT'];

/** Copy for whole CLASSES of failure the catalog can't name individually. */
export const KIND_DEFAULTS: Record<ErrorKind, ErrorInfo> = {
  offline: {
    title: "You're offline",
    message: 'Check your connection and try again.',
    retryable: true,
  },
  timeout: {
    title: 'Taking too long',
    message: 'The server took a while to respond. Give it another try.',
    retryable: true,
  },
  server: {
    title: 'Something went wrong on our end',
    message: "This one's on us — please try again in a moment.",
    retryable: true,
  },
  gateway: {
    title: "Payment didn't go through",
    message: "We couldn't confirm this payment. You weren't charged — try again or pick another method.",
    retryable: true,
  },
  auth: {
    title: 'Please sign in again',
    message: 'Your session expired. Sign in to pick up where you left off.',
    retryable: false,
    action: { label: 'Sign in', kind: 'signin' },
  },
  forbidden: {
    title: 'Not allowed',
    message: "You don't have access to do that.",
    retryable: false,
  },
  not_found: {
    title: 'Not found',
    message: "This isn't here anymore — it may have been removed.",
    retryable: false,
  },
  conflict: {
    title: 'Just updated elsewhere',
    message: 'Showing the latest version. Try again if you still need to.',
    retryable: false,
  },
  rate_limited: {
    title: 'Slow down a sec',
    message: "You've done that a lot in a short time. Wait a moment and try again.",
    retryable: true,
  },
  validation: {
    title: 'Check your details',
    message: 'Some information needs fixing before you can continue.',
    retryable: false,
  },
  unknown: {
    title: 'Something went wrong',
    message: 'Please try again.',
    retryable: true,
  },
};

/** The shape produced by the `api.ts` interceptor (additive `code`/`kind`). */
interface NormalizedError {
  status?: number;
  message?: string;
  code?: string;
  kind?: ErrorKind;
}

/** Kinds whose backend `message` is generic/useless — always prefer our copy. */
const MESSAGE_IS_USELESS: ReadonlyArray<ErrorKind> = [
  'offline',
  'timeout',
  'server',
  'auth',
  'rate_limited',
];

export interface DescribeErrorOptions {
  /** Caller's domain copy — normally a mid-tier fallback (step 5). */
  fallback?: string;
  /**
   * Keep the caller's `fallback` even for a kind whose backend message we'd
   * normally overrule (offline/timeout/server/…).
   *
   * Use it where the class copy is TRUE but useless: the safety path is the
   * case that forced this. `copy.safety.sosFailed` ("Please try again, or call
   * for help directly") was written for exactly the dead-zone SOS, and step 3
   * discarded it in favour of "You're offline — check your connection and try
   * again" — the least actionable sentence you can hand someone in danger.
   * Opt in only where the caller's copy tells the user what to DO instead.
   */
  preferFallback?: boolean;
  /**
   * Backend codes whose SERVER message wins at this call site, even though the
   * catalog has fixed copy for the code.
   *
   * For endpoints that answer a refusal with a generic code but a specific
   * sentence. The case that forced it: before RETRY_NOT_ALLOWED and
   * ACCEPT_NOT_ALLOWED existed, retry-match and the runner accept refused
   * with BOOKING_CONFLICT + an exact reason ("This booking was already
   * refunded…", "This errand needs a motorcycle…"), and the catalog replaced
   * it with "Finish or cancel your errand in progress" — wrong for both.
   */
  trustServerMessageFor?: ReadonlyArray<string>;
}

/**
 * Resolve any error to honest, actionable copy. Never throws; safe defaults.
 */
export function describeError(err: unknown, opts?: DescribeErrorOptions): ErrorInfo {
  const e = (err ?? {}) as NormalizedError;
  const serverMessage =
    typeof e.message === 'string' && e.message.trim() ? e.message : null;

  // 0. Refusals the server words for this exact action (see SERVER_WORDED).
  if (e.code && SERVER_WORDED[e.code]) {
    const worded = SERVER_WORDED[e.code];
    return serverMessage ? { ...worded, message: serverMessage } : worded;
  }
  if (e.code && serverMessage && opts?.trustServerMessageFor?.includes(e.code)) {
    // Not the catalog's title either — for these call sites it is just as
    // wrong as its message ("You already have an errand").
    return { title: "Couldn't do that", message: serverMessage, retryable: false };
  }

  // 1. Exact backend code.
  if (e.code && ERROR_CATALOG[e.code]) return ERROR_CATALOG[e.code];

  // 2. Payment/gateway → single payment copy source.
  if (e.kind === 'gateway' || (e.code && /GATEWAY/i.test(e.code))) {
    const p = mapFailureReason(e.code ?? e.message);
    return { title: p.title, message: p.message, retryable: p.retryable };
  }

  const kind: ErrorKind = e.kind ?? 'unknown';

  // 3. Classes where the backend message is noise. The caller can still keep
  //    its own copy when that copy is the actionable half (see preferFallback).
  if (MESSAGE_IS_USELESS.includes(kind)) {
    return opts?.preferFallback && opts.fallback
      ? { ...KIND_DEFAULTS[kind], message: opts.fallback }
      : KIND_DEFAULTS[kind];
  }

  // 4. Trust the backend message for validation / specific 4xx.
  if (e.message) return { ...KIND_DEFAULTS[kind], message: e.message };

  // 5. Caller fallback → generic default.
  if (opts?.fallback) return { ...KIND_DEFAULTS[kind], message: opts.fallback };
  return KIND_DEFAULTS[kind];
}

/** Convenience for the dominant `toast.error(...)` call-site pattern. */
export function errorMessage(
  err: unknown,
  fallback?: string,
  opts?: Omit<DescribeErrorOptions, 'fallback'>,
): string {
  return describeError(err, { ...opts, fallback }).message;
}
