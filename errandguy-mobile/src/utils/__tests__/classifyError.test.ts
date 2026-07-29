import { classifyError } from '../classifyError';

describe('classifyError', () => {
  it('distinguishes offline from a client-side timeout (both have no response)', () => {
    expect(classifyError(0)).toBe('offline');
    expect(classifyError(undefined)).toBe('offline');
    expect(classifyError(0, 'ECONNABORTED')).toBe('timeout');
  });

  it('maps HTTP statuses to kinds', () => {
    expect(classifyError(401)).toBe('auth');
    expect(classifyError(403)).toBe('forbidden');
    expect(classifyError(404)).toBe('not_found');
    expect(classifyError(409)).toBe('conflict');
    expect(classifyError(422)).toBe('validation');
    expect(classifyError(429)).toBe('rate_limited');
    expect(classifyError(500)).toBe('server');
    expect(classifyError(503)).toBe('server');
    expect(classifyError(418)).toBe('unknown');
  });

  it('treats a payment-gateway 422 as a gateway failure, not validation', () => {
    expect(classifyError(422, undefined, 'PAYMENT_GATEWAY_ERROR')).toBe('gateway');
    // Other business-rule 422s remain validation (their copy comes from the catalog).
    expect(classifyError(422, undefined, 'INSUFFICIENT_WALLET_BALANCE')).toBe('validation');
  });
});
