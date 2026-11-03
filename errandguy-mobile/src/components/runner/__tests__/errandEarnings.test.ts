import { cancelFeeEarned, earnedLabel, settledIn, splitEarnings } from '../errandEarnings';
import { makeBooking } from '../../../__mocks__/factories';
import type { Booking } from '../../../types';

const row = (extra: Record<string, unknown>): Booking =>
  ({ ...makeBooking({ status: 'completed' }), ...extra }) as Booking;

describe('what a runner actually earned on an errand', () => {
  it('a cancelled errand shows its cancellation fee, never the would-be payout', () => {
    expect(
      earnedLabel(row({ status: 'cancelled', runner_payout: 85, cancellation_fee: 20 })),
    ).toBe('₱20.00');
  });

  it('a cancelled errand with no fee earned nothing', () => {
    expect(
      earnedLabel(row({ status: 'cancelled', runner_payout: 85, cancellation_fee: null })),
    ).toBe('₱0.00');
    // Laravel decimals arrive as strings.
    expect(cancelFeeEarned({ cancellation_fee: '0.00' as unknown as number })).toBe(0);
    expect(cancelFeeEarned({ cancellation_fee: '20.00' as unknown as number })).toBe(20);
  });

  it('a completed errand shows its payout', () => {
    expect(earnedLabel(row({ runner_payout: 85 }))).toBe('₱85.00');
    expect(earnedLabel(row({ runner_payout: null }))).toBe('Payout pending');
  });
});

describe('cash vs paid online', () => {
  it('reads how the errand settled, and never guesses', () => {
    expect(settledIn(row({ payment_method_type: 'cash' }))).toBe('cash');
    expect(settledIn(row({ payment_method_type: 'gcash' }))).toBe('online');
    expect(settledIn(row({ payment_method_type: null, payment_method: 'wallet' }))).toBe('online');
    expect(settledIn(row({ payment_method_type: null, payment_method: null }))).toBeNull();
  });

  it('splits the period total when the rows add up to it', () => {
    const rows = [
      row({ payment_method_type: 'cash', runner_payout: '85.00' }),
      row({ payment_method_type: 'cash', runner_payout: 100 }),
      row({ payment_method_type: 'maya', runner_payout: 60.5 }),
    ];
    expect(splitEarnings(rows, 245.5)).toEqual({ cash: 185, wallet: 60.5 });
  });

  it('hides the split rather than show one that disagrees with the total', () => {
    const rows = [
      row({ payment_method_type: 'cash', runner_payout: 85 }),
      row({ payment_method_type: 'gcash', runner_payout: 60 }),
    ];
    // A truncated page / stale cache: rows don't sum to the server's total.
    expect(splitEarnings(rows, 300)).toBeNull();
    // A row that doesn't say how it was paid.
    expect(
      splitEarnings([...rows, row({ payment_method_type: null, payment_method: null, runner_payout: 0 })], 145),
    ).toBeNull();
    expect(splitEarnings([], 0)).toBeNull();
    expect(splitEarnings(rows, null)).toBeNull();
  });
});
