import { bookingMoneyOutcome } from '../BookingDetailSheet';
import type { Booking } from '../../../types';

/**
 * The cancelled errand's money outcome, as every durable surface reads it
 * (the Activity detail sheet and the tracking receipt share this helper).
 *
 * The invariant under test is that NOTHING is computed here: the fee the
 * server recorded is already capped and zeroed by settlement (PRICE-3 /
 * PRICE-4), so the client must render `refunded_amount` as sent and never
 * recompute "total − fee" — which would print a phantom refund on a cash
 * booking and a phantom charge on a capped one.
 */
// Deliberately loose: the point of these cases is the SERVER's wire shape,
// where Laravel casts decimals to strings ('20.00') that the Booking type
// declares as numbers.
const base = (over: Record<string, unknown>): Booking =>
  ({
    id: 'b1',
    status: 'cancelled',
    total_amount: 500,
    cancellation_fee: null,
    cancellation_reason: null,
    ...over,
  }) as unknown as Booking;

describe('bookingMoneyOutcome', () => {
  it('reports the fee, the refund and the wallet destination the server sent', () => {
    const outcome = bookingMoneyOutcome(
      base({
        cancellation_fee: '20.00',
        refunded_amount: 480,
        refund_destination: 'wallet',
      }),
    );

    expect(outcome).toEqual({
      fee: 20,
      refunded: 480,
      destination: 'wallet',
      moneyMoved: true,
    });
  });

  it('claims no refund on a cash cancel, where nothing was ever collected', () => {
    // refunded_amount is null (payment_status never reached 'refunded') and
    // the fee is zero — the sheet must NOT derive 500 − 0 = 500 "refunded".
    const outcome = bookingMoneyOutcome(
      base({ cancellation_fee: '0.00', refunded_amount: null }),
    );

    expect(outcome.refunded).toBeNull();
    expect(outcome.destination).toBeNull();
    expect(outcome.moneyMoved).toBe(false);
  });

  it('treats a fully-consumed fare as money moved with nothing to give back', () => {
    // ₱15 fare, fee capped at ₱15 → refunded 0.0 (not null): money WAS
    // collected, the fee just took all of it.
    const outcome = bookingMoneyOutcome(
      base({
        total_amount: 15,
        cancellation_fee: '15.00',
        refunded_amount: 0,
        refund_destination: null,
      }),
    );

    expect(outcome.fee).toBe(15);
    expect(outcome.refunded).toBe(0);
    expect(outcome.destination).toBeNull();
    expect(outcome.moneyMoved).toBe(true);
  });

  it('survives an older payload with no refund fields at all', () => {
    const outcome = bookingMoneyOutcome(base({ cancellation_fee: '20.00' }));

    expect(outcome.fee).toBe(20);
    expect(outcome.refunded).toBeNull();
    expect(outcome.destination).toBeNull();
  });

  it('falls back to the wallet when a refund arrives with no destination', () => {
    // Cancels and no-runner refunds are wallet credits, never source
    // reversals — a refund figure with a missing label is still a wallet one.
    const outcome = bookingMoneyOutcome(
      base({ refunded_amount: '500.00', cancellation_fee: null }),
    );

    expect(outcome.refunded).toBe(500);
    expect(outcome.destination).toBe('wallet');
    expect(outcome.moneyMoved).toBe(true);
  });

  it('never yields NaN from a junk value', () => {
    const outcome = bookingMoneyOutcome(
      base({ cancellation_fee: 'nonsense', refunded_amount: 'nonsense' }),
    );

    expect(outcome.fee).toBe(0);
    expect(outcome.refunded).toBe(0);
    expect(outcome.moneyMoved).toBe(false);
  });
});
