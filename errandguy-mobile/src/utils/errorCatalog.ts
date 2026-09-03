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
  action?: { label: string; kind: 'topup' | 'signin' | 'retry' | 'contact' };
}

/** Backend `code` (UPPER_SNAKE, matches Laravel App\Support\ErrorCode) → copy.
 *  Only entries where we can say something better than the backend message. */
export const ERROR_CATALOG: Record<string, ErrorInfo> = {
  INSUFFICIENT_WALLET_BALANCE: {
    title: 'Not enough balance',
    message: "Your wallet can't cover this. Top up or choose another payment method.",
    retryable: true,
    action: { label: 'Top up', kind: 'topup' },
  },
  TOPUP_MIN_AMOUNT: {
    title: 'Amount too low',
    message: "That's below the minimum top-up. Enter a larger amount to continue.",
    retryable: true,
  },
  PAYOUT_MIN_AMOUNT: {
    title: 'Amount too low',
    message: "That's below the minimum payout. Request a larger amount to continue.",
    retryable: true,
  },
  PAYMENT_METHOD_NOT_FOUND: {
    title: 'Payment method unavailable',
    message: "That payment method isn't on your account anymore. Pick another one.",
    retryable: false,
  },
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
  PROMO_INVALID: {
    title: 'Promo not valid',
    message: "That promo code isn't valid or has expired.",
    retryable: false,
  },
  PROMO_NOT_ELIGIBLE: {
    title: "Promo doesn't apply",
    message: "This order doesn't meet the requirements for that promo.",
    retryable: false,
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
}

/**
 * Resolve any error to honest, actionable copy. Never throws; safe defaults.
 */
export function describeError(err: unknown, opts?: DescribeErrorOptions): ErrorInfo {
  const e = (err ?? {}) as NormalizedError;

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
  opts?: { preferFallback?: boolean },
): string {
  return describeError(err, { fallback, preferFallback: opts?.preferFallback })
    .message;
}
