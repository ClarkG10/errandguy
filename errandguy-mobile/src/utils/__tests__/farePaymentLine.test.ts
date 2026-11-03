import { farePaymentLine } from '../farePaymentLine';
import type { BookingStatus } from '../../types';

const b = (payment_method: string | null, status: BookingStatus = 'accepted', awaiting_payment?: boolean) => ({
  payment_method,
  status,
  awaiting_payment,
});

/**
 * The fare row on tracking: how the errand fare is paid, said plainly — and
 * never "paid" for a GCash/Maya charge that hasn't gone through.
 */
describe('farePaymentLine', () => {
  it('cash is paid to the runner, in cash', () => {
    expect(farePaymentLine(b('cash'))).toBe('Pay the runner in cash');
    expect(farePaymentLine(b('cash', 'delivered'))).toBe('Pay the runner in cash');
    expect(farePaymentLine(b('cash', 'completed'))).toBe('Paid to the runner in cash');
  });

  it('wallet is already paid', () => {
    expect(farePaymentLine(b('wallet'))).toBe('Paid from wallet');
  });

  it.each([
    ['gcash', 'GCash'],
    ['maya', 'Maya'],
  ])('%s is paid once the server confirmed it', (method, name) => {
    expect(farePaymentLine(b(method, 'accepted', false))).toBe(`Paid with ${name}`);
  });

  it.each([
    ['gcash', 'GCash'],
    ['maya', 'Maya'],
  ])('an unpaid %s booking is never called paid', (method, name) => {
    const line = farePaymentLine(b(method, 'pending', true));
    expect(line).toBe(`Waiting for your ${name} payment`);
    expect(line).not.toMatch(/paid with/i);
  });

  it('says nothing about a method it does not know', () => {
    expect(farePaymentLine(b(null))).toBeNull();
    expect(farePaymentLine(b('card'))).toBeNull();
  });
});
