import { describeError, errorMessage } from '../errorCatalog';

describe('describeError', () => {
  it('leads with an exact backend code when we have better copy', () => {
    const info = describeError({ status: 422, code: 'INSUFFICIENT_WALLET_BALANCE', message: 'nope' });
    expect(info.title).toBe('Not enough balance');
    expect(info.action?.kind).toBe('topup');
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

  it('never throws on garbage input', () => {
    expect(() => describeError(undefined)).not.toThrow();
    expect(() => describeError('boom')).not.toThrow();
    expect(() => describeError(42)).not.toThrow();
  });
});
