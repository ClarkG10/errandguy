import {
  describeError,
  errorMessage,
  ERROR_CATALOG,
  LEGACY_WORDED_REFUSALS,
} from '../errorCatalog';

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

/**
 * Refusals the server words for the ONE action that was refused. "Search
 * again" on a refunded errand and a runner's accept of an errand that needs a
 * motorcycle both came back as BOOKING_CONFLICT, and the catalog swapped the
 * exact reason for "You already have an errand — finish or cancel your errand
 * in progress", true for neither.
 */
describe('action-worded refusals', () => {
  const NOT_THE_CONFLICT_COPY = /already have an errand|in progress/i;

  it.each([
    [
      'RETRY_NOT_ALLOWED',
      'This booking was already refunded, so it can’t be retried. Please create a new booking to try again.',
    ],
    [
      'ACCEPT_NOT_ALLOWED',
      'This errand needs a motorcycle or car. If your vehicle has changed, update it in Settings.',
    ],
    ['ACCEPT_NOT_ALLOWED', "You can't accept your own errand."],
  ])('%s shows the server’s sentence verbatim', (code, message) => {
    const info = describeError({ status: 409, kind: 'conflict', code, message });
    expect(info.message).toBe(message);
    expect(info.title).not.toMatch(NOT_THE_CONFLICT_COPY);
    expect(info.retryable).toBe(false);
  });

  it('still says something sensible when the server sent no message', () => {
    expect(describeError({ status: 409, kind: 'conflict', code: 'RETRY_NOT_ALLOWED' }).message).toMatch(
      /Book it again/,
    );
    expect(describeError({ status: 409, kind: 'conflict', code: 'ACCEPT_NOT_ALLOWED' }).message).toMatch(
      /can’t accept/,
    );
  });

  it('an older server’s BOOKING_CONFLICT keeps its sentence at the call sites that opt in', () => {
    const err = {
      status: 409,
      kind: 'conflict',
      code: 'BOOKING_CONFLICT',
      message: 'This errand is scheduled for later. We’ll start looking for a runner 15 minutes before its time.',
    };
    const info = describeError(err, { trustServerMessageFor: LEGACY_WORDED_REFUSALS });
    expect(info.message).toBe(err.message);
    expect(info.title).not.toMatch(NOT_THE_CONFLICT_COPY);
    expect(errorMessage(err, 'fallback', { trustServerMessageFor: LEGACY_WORDED_REFUSALS })).toBe(
      err.message,
    );
  });

  it('…and nowhere else: elsewhere BOOKING_CONFLICT really is "an errand in progress"', () => {
    const err = { status: 409, kind: 'conflict', code: 'BOOKING_CONFLICT', message: 'whatever' };
    expect(describeError(err).title).toBe('You already have an errand');
    // An opt-in for a different code changes nothing for this one.
    expect(describeError(err, { trustServerMessageFor: ['BOOKING_STALE'] }).title).toBe(
      'You already have an errand',
    );
  });

  it('an opt-in without a server message falls back to the catalog', () => {
    const info = describeError(
      { status: 409, kind: 'conflict', code: 'BOOKING_CONFLICT' },
      { trustServerMessageFor: LEGACY_WORDED_REFUSALS },
    );
    expect(info).toEqual(ERROR_CATALOG.BOOKING_CONFLICT);
  });
});
