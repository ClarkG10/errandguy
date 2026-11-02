import { canRetryMatch, noRunnerRebookLine, refundedToWallet } from '../noRunner';

describe('no-runner recovery', () => {
  it('only an explicit can_retry_match=false takes Search again away', () => {
    expect(canRetryMatch({ can_retry_match: false })).toBe(false);
    expect(canRetryMatch({ can_retry_match: true })).toBe(true);
    // An older server sends no flag: behave as before, the server still has
    // the last word.
    expect(canRetryMatch({})).toBe(true);
    expect(canRetryMatch(null)).toBe(true);
  });

  it('reads the refund off the server field, including Laravel’s decimal strings', () => {
    expect(refundedToWallet({ refunded_amount: '480.00' })).toBe(480);
    expect(refundedToWallet({ refunded_amount: 92.5 })).toBe(92.5);
    expect(refundedToWallet({ refunded_amount: 0 })).toBe(0);
    expect(refundedToWallet({ refunded_amount: null })).toBe(0);
    expect(refundedToWallet({ refunded_amount: 'abc' })).toBe(0);
    expect(refundedToWallet(undefined)).toBe(0);
  });

  it('says where the money went when there was some', () => {
    expect(noRunnerRebookLine({ can_retry_match: false, refunded_amount: '480.00' })).toBe(
      'No runner took this errand, so your ₱480.00 went back to your ErrandGuy wallet. Book it again to find a runner.',
    );
  });

  it('never claims a refund that did not happen', () => {
    const line = noRunnerRebookLine({ can_retry_match: false, refunded_amount: null });
    expect(line).not.toMatch(/wallet/i);
    expect(line).toMatch(/Book it again/);
  });
});
