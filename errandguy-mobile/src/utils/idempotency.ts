import * as Crypto from 'expo-crypto';

/**
 * A fresh idempotency key for ONE payment attempt. Sent as the
 * `Idempotency-Key` header so a double-tap or network retry of the same
 * attempt is collapsed server-side into a single charge/booking/top-up.
 *
 * Mint exactly once per attempt (in paymentStore.beginAttempt) and REUSE it on
 * retry of that attempt — only a genuinely new attempt (user changed amount /
 * method / explicitly started over) should mint a new one.
 *
 * RFC-4122 v4 via expo-crypto (synchronous, cryptographically random).
 */
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}
