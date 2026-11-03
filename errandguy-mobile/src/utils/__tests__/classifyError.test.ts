import { classifyError, parseRetryAfter } from '../classifyError';

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

describe('parseRetryAfter (a 429\'s wait)', () => {
  it('reads seconds from the envelope number or the header string', () => {
    expect(parseRetryAfter(45)).toBe(45);
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter(' 7 ')).toBe(7);
    expect(parseRetryAfter(2.2)).toBe(3);
  });

  it('reads an HTTP-date header as the seconds until then', () => {
    const now = Date.parse('2026-11-03T10:00:00Z');
    expect(parseRetryAfter('Tue, 03 Nov 2026 10:02:00 GMT', now)).toBe(120);
  });

  it('is null when nothing (or nothing usable) was said', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter(0)).toBeNull();
    expect(parseRetryAfter(-5)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    const now = Date.parse('2026-11-03T10:00:00Z');
    expect(parseRetryAfter('Tue, 03 Nov 2026 09:00:00 GMT', now)).toBeNull();
  });
});
