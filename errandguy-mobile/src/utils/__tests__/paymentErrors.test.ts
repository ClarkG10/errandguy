import { mapFailureReason } from '../paymentErrors';

describe('mapFailureReason', () => {
  it('never blames the user vaguely and always stays retryable/safe by default', () => {
    const d = mapFailureReason(undefined);
    expect(d.retryable).toBe(true);
    expect(d.message.toLowerCase()).toContain("weren't charged");
    expect(mapFailureReason('')).toEqual(d);
    expect(mapFailureReason('some_unmapped_gateway_code')).toEqual(d);
  });

  it('maps known reasons to specific, actionable copy', () => {
    expect(mapFailureReason('INSUFFICIENT_BALANCE').title).toBe('Insufficient funds');
    expect(mapFailureReason('insufficient').title).toBe('Insufficient funds');
    expect(mapFailureReason('expired').title).toBe('Payment expired');
    expect(mapFailureReason('DECLINED_BY_PROVIDER').title).toBe('Payment declined');
    expect(mapFailureReason('rejected').title).toBe('Payment declined');
    expect(mapFailureReason('user_cancelled').title).toBe('Payment cancelled');
    expect(mapFailureReason('AUTHENTICATION_REQUIRED').title).toBe('Verification needed');
  });

  it('says a refunded charge went back to the wallet — never "you weren\'t charged"', () => {
    // The transaction-status probe answers `refunded` for a GCash/Maya tip
    // that also succeeded after the errand was already tipped.
    const r = mapFailureReason('refunded');
    expect(r.title).toBe('Payment refunded');
    expect(r.message).toBe('This payment was refunded to your ErrandGuy wallet.');
    expect(r.message.toLowerCase()).not.toContain("weren't charged");
    expect(r.retryable).toBe(false);
  });
});
