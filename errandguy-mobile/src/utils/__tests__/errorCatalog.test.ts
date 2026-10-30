import { describeError, errorMessage, ERROR_CATALOG } from '../errorCatalog';

describe('describeError', () => {
  it('leads with an exact backend code when we have better copy', () => {
    const info = describeError({ status: 409, code: 'BOOKING_STALE', kind: 'conflict', message: 'nope' });
    expect(info.title).toBe('This errand just changed');
    expect(info.message).not.toBe('nope');
  });

  // The money refusals carry the most specific sentence there is — amounts,
  // minimums, what is owed — so the catalog must never overrule them with a
  // vaguer fixed line (the old INSUFFICIENT_WALLET_BALANCE entry also told
  // customers to "Top up", which no longer exists).
  it.each([
    [
      'INSUFFICIENT_WALLET_BALANCE',
      422,
      'You requested ₱500.00 but your available balance is ₱120.00. Lower the amount and try again.',
    ],
    [
      'PAYOUT_MIN_AMOUNT',
      422,
      'The minimum payout is ₱100.00. Please request at least that amount.',
    ],
    [
      'CASH_DEBT_OUTSTANDING',
      422,
      'You owe ₱1,250.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,000.',
    ],
    // The cash-errand accept refusal is a 409 (the errand can't be taken).
    [
      'CASH_DEBT_OUTSTANDING',
      409,
      'You owe ₱1,000.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,000.',
    ],
    [
      'PAYOUT_METHOD_REQUIRED',
      422,
      'Your wallet has ₱80.00. Tell us where to send it — a GCash or Maya number — and we’ll send it to you as part of deleting your account.',
    ],
  ])('passes the server message through for %s (%i)', (code, status, message) => {
    const kind = status === 409 ? 'conflict' : 'validation';
    expect(errorMessage({ status, code, kind, message }, 'fallback')).toBe(message);
  });

  it('offers no top-up action anywhere in the catalog', () => {
    for (const code of Object.keys(ERROR_CATALOG)) {
      expect(JSON.stringify(ERROR_CATALOG[code]).toLowerCase()).not.toMatch(/top.?up/);
    }
  });

  it('delegates payment/gateway failures to the single payment copy source', () => {
    const info = describeError({ status: 422, code: 'PAYMENT_GATEWAY_ERROR', kind: 'gateway' });
    // Honest, safe default from paymentErrors.ts.
    expect(info.message.toLowerCase()).toContain("weren't charged");
    expect(info.retryable).toBe(true);
  });

  it('uses honest class copy for offline / timeout / server, ignoring the backend message', () => {
    expect(describeError({ status: 0, kind: 'offline' }).title).toBe("You're offline");
    expect(describeError({ status: 0, kind: 'timeout' }).title).toBe('Taking too long');
    // A 5xx carries a generic message, but describeError prefers the server-kind copy.
    const server = describeError({ status: 500, kind: 'server', message: 'Something went wrong. Please try again later.' });
    expect(server.title).toBe('Something went wrong on our end');
  });

  it('trusts the backend message for validation and specific 4xx', () => {
    const info = describeError({ status: 422, kind: 'validation', message: 'The email field is required.' });
    expect(info.message).toBe('The email field is required.');
  });

  it('falls back to the caller fallback, then a generic default', () => {
    expect(errorMessage({ status: 400, kind: 'unknown' }, 'Could not save your address.')).toBe(
      'Could not save your address.',
    );
    expect(errorMessage(null)).toBe('Please try again.');
  });

  it('keeps a safety-critical caller fallback that the offline class would have eaten', () => {
    // The bug this closes: `copy.safety.sosFailed` ("…or call for help
    // directly") was written for exactly the dead-zone SOS, and step 3
    // discarded it for "You're offline — check your connection and try again",
    // the least actionable sentence you can hand someone in danger.
    const sosCopy = 'Couldn’t trigger SOS. Please try again, or call for help directly.';
    expect(errorMessage({ status: 0, kind: 'offline' }, sosCopy)).toBe(
      'Check your connection and try again.',
    );
    expect(
      errorMessage({ status: 0, kind: 'offline' }, sosCopy, { preferFallback: true }),
    ).toBe(sosCopy);
    // The class TITLE still leads — only the actionable line is the caller's.
    const info = describeError(
      { status: 0, kind: 'timeout' },
      { fallback: sosCopy, preferFallback: true },
    );
    expect(info.title).toBe('Taking too long');
    expect(info.message).toBe(sosCopy);
  });

  it('preferFallback never overrides a named backend code', () => {
    const info = describeError(
      { status: 422, code: 'BOOKING_STATE_INVALID', kind: 'validation' },
      { fallback: 'my copy', preferFallback: true },
    );
    expect(info.title).toBe("That step isn't available");
  });

  it('never throws on garbage input', () => {
    expect(() => describeError(undefined)).not.toThrow();
    expect(() => describeError('boom')).not.toThrow();
    expect(() => describeError(42)).not.toThrow();
  });
});
