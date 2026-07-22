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
    expect(mapFailureReason('CARD_DECLINED').title).toBe('Payment declined');
    expect(mapFailureReason('rejected').title).toBe('Payment declined');
    expect(mapFailureReason('user_cancelled').title).toBe('Payment cancelled');
    expect(mapFailureReason('AUTHENTICATION_REQUIRED').title).toBe('Verification needed');
  });
});
