/**
 * Classifies a normalized API error into a small, honest set of "kinds" so the
 * UI can say something specific instead of collapsing everything into
 * "Something went wrong." Consumed by `errorCatalog.ts` (which turns a kind +
 * backend code into user copy) and produced by the `api.ts` interceptor.
 *
 * The distinction the app was missing before: offline vs timeout vs a real 5xx
 * vs a payment-gateway rejection — they demand different copy and different
 * retryability, but all three used to read the same.
 */
export type ErrorKind =
  | 'offline'
  | 'timeout'
  | 'server'
  | 'gateway'
  | 'validation'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unknown';

/**
 * Map an HTTP status (and, for the no-response case, the axios error code) to a
 * kind. Pure and synchronous so it's trivially unit-testable.
 *
 * @param status    Normalized status. `0`/`undefined` means no HTTP response
 *                  (transport failure) — offline or a client-side timeout.
 * @param axiosCode The axios `error.code` (e.g. `'ECONNABORTED'` on timeout).
 * @param backendCode The backend's machine `code`, used only to distinguish a
 *                  payment/gateway 422 from an ordinary validation 422.
 */
export function classifyError(
  status: number | undefined,
  axiosCode?: string,
  backendCode?: string,
): ErrorKind {
  // No HTTP response at all → transport failure. A client-abort timeout
  // (ECONNABORTED) is a distinct, honest case from being offline.
  if (status === undefined || status === 0) {
    return axiosCode === 'ECONNABORTED' ? 'timeout' : 'offline';
  }

  switch (status) {
    case 401:
      return 'auth';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      // A payment gateway rejection arrives as 422 + PAYMENT_GATEWAY_ERROR;
      // treat that as a gateway failure (honest "you weren't charged" copy)
      // rather than a form-validation error. Other business-rule 422s (e.g.
      // INSUFFICIENT_WALLET_BALANCE) get their specific copy via the catalog's
      // code lookup regardless of this kind.
      return backendCode && /GATEWAY/i.test(backendCode) ? 'gateway' : 'validation';
    case 429:
      return 'rate_limited';
  }

  if (status >= 500) return 'server';
  return 'unknown';
}
