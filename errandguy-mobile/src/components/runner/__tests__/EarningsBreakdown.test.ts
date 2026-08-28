import { computeEarningsBreakdown } from '../EarningsBreakdown';
import type { Booking } from '../../../types';

/** Minimal booking shaped like a completed runner earnings row. */
const booking = (over: Record<string, unknown> = {}): Booking =>
  ({
    id: 'b1',
    pricing_mode: 'fixed',
    distance_km: 3,
    base_fee: 50,
    distance_fee: 30,
    service_fee: 15.75,
    surcharge: 0,
    promo_discount: 0,
    total_amount: 120.75,
    customer_offer: null,
    // PricingService: payout = base + vehicle_premium + distance + surcharge
    //               = 50 + 25 + 30 + 0 = 105
    runner_payout: 105,
    ...over,
  }) as unknown as Booking;

const round2 = (v: number) => Math.round(v * 100) / 100;

const sum = (lines: { amount: number }[]) => round2(lines.reduce((t, l) => t + l.amount, 0));

describe('computeEarningsBreakdown — fixed pricing', () => {
  it('decomposes the payout so the lines add up to it exactly', () => {
    const b = computeEarningsBreakdown(booking());
    expect(b.itemized).toBe(true);
    expect(b.mode).toBe('fixed');
    expect(sum(b.lines)).toBe(105);
    expect(b.payout).toBe(105);
  });

  it('recovers the unstored vehicle premium as a residual line', () => {
    const b = computeEarningsBreakdown(booking());
    const vehicle = b.lines.find((l) => l.label === 'Vehicle & handling');
    expect(vehicle?.amount).toBe(25);
  });

  it('omits the residual line when there is no vehicle premium (walking)', () => {
    const b = computeEarningsBreakdown(booking({ runner_payout: 80 }));
    expect(b.lines.map((l) => l.label)).toEqual(['Base fare', 'Distance · 3.0 km']);
    expect(sum(b.lines)).toBe(80);
  });

  it('includes a surcharge line and still balances', () => {
    const b = computeEarningsBreakdown(
      booking({ surcharge: 15, runner_payout: 120 }),
    );
    expect(sum(b.lines)).toBe(120);
    expect(b.lines.some((l) => l.label === 'Surcharge & extras')).toBe(true);
  });

  it('refuses to itemize when the stored components exceed the payout', () => {
    // A hand-edited / legacy row: printing a negative invented line would be
    // worse than showing the payout alone.
    const b = computeEarningsBreakdown(booking({ runner_payout: 40 }));
    expect(b.itemized).toBe(false);
    expect(b.lines).toEqual([]);
    expect(b.payout).toBe(40);
  });

  it('handles Laravel decimal casts arriving as strings', () => {
    const b = computeEarningsBreakdown(
      booking({ base_fee: '50.00', distance_fee: '30.00', runner_payout: '105.00' }),
    );
    expect(b.itemized).toBe(true);
    expect(sum(b.lines)).toBe(105);
    expect(b.payout).toBe(105);
  });

  it('prints the customer bill and the fee that separates it from the payout', () => {
    const b = computeEarningsBreakdown(booking());
    expect(b.platformFee).toBe(15.75);
    expect(b.feeNote).toBe('Customer paid ₱120.75 · platform fee ₱15.75');
  });

  it('is not itemized when the server has not computed a payout yet', () => {
    const b = computeEarningsBreakdown(booking({ runner_payout: null }));
    expect(b.itemized).toBe(false);
    expect(b.payout).toBeNull();
  });
});

describe('computeEarningsBreakdown — negotiate pricing', () => {
  it('shows offer minus platform fee when the arithmetic checks out', () => {
    const b = computeEarningsBreakdown(
      booking({
        pricing_mode: 'negotiate',
        customer_offer: 200,
        service_fee: 15.75,
        total_amount: 200,
        runner_payout: 184.25,
      }),
    );
    expect(b.itemized).toBe(true);
    expect(b.mode).toBe('negotiate');
    expect(b.lines).toEqual([
      { label: 'Agreed offer', amount: 200 },
      { label: 'Platform fee', amount: -15.75 },
    ]);
    expect(sum(b.lines)).toBe(184.25);
  });

  it('falls back rather than print offer − fee ≠ payout', () => {
    const b = computeEarningsBreakdown(
      booking({
        pricing_mode: 'negotiate',
        customer_offer: 200,
        service_fee: 15.75,
        runner_payout: 150,
      }),
    );
    expect(b.itemized).toBe(false);
  });
});

describe('computeEarningsBreakdown — promo bookings', () => {
  // BookingController::store subtracts the discount from total_amount and
  // leaves runner_payout at its pre-promo value: the promo is funded by the
  // platform's cut, so the runner's take-home is unchanged.
  const promoBooking = (over: Record<string, unknown> = {}) =>
    booking({ promo_discount: 10, total_amount: 110.75, ...over });

  it('reports the platform fee net of the promo, not the gross service fee', () => {
    const b = computeEarningsBreakdown(promoBooking());
    expect(b.platformFee).toBe(5.75);
    expect(b.customerPaid).toBe(110.75);
  });

  it('keeps customer paid − platform fee === payout on every row', () => {
    for (const over of [
      {},
      { promo_discount: 15.75, total_amount: 105 },
      { pricing_mode: 'negotiate', customer_offer: 200, total_amount: 190, runner_payout: 184.25 },
      { payment_method_type: 'cash' },
    ]) {
      const b = computeEarningsBreakdown(promoBooking(over));
      expect(round2(b.customerPaid! - b.platformFee!)).toBe(b.payout);
    }
  });

  it('quotes the same fee the cash settlement actually debits', () => {
    const b = computeEarningsBreakdown(promoBooking({ payment_method_type: 'cash' }));
    expect(b.cashSettlement).toBe(5.75);
    expect(b.feeNote).toContain('₱5.75');
    expect(b.settlementNote).toContain('₱5.75');
    // The gross ₱15.75 fee must never be quoted as the platform's take.
    expect(b.feeNote).not.toMatch(/platform fee ₱15\.75/);
  });

  it('names the gross fee and the discount so the subtraction is visible', () => {
    const b = computeEarningsBreakdown(promoBooking());
    expect(b.feeNote).toBe(
      'Customer paid ₱110.75 after a ₱10.00 promo — the platform funded that ' +
        'from its ₱15.75 fee and kept ₱5.75.',
    );
  });

  it('drops the promo wording when the figures cannot be reconciled', () => {
    // Legacy / hand-edited row: fee − promo ≠ what the platform kept.
    const b = computeEarningsBreakdown(promoBooking({ total_amount: 118 }));
    expect(b.feeNote).toBe('Customer paid ₱118.00 · platform fee ₱13.00');
  });

  it('has no footer figure to print before the payout exists', () => {
    const b = computeEarningsBreakdown(promoBooking({ runner_payout: null }));
    expect(b.platformFee).toBeNull();
    expect(b.feeNote).toBeNull();
  });
});

describe('computeEarningsBreakdown — settlement note', () => {
  it('explains the cash model with the exact wallet debit', () => {
    const b = computeEarningsBreakdown(
      booking({ payment_method_type: 'cash', total_amount: 120.75, runner_payout: 105 }),
    );
    expect(b.cashSettlement).toBe(15.75);
    expect(b.settlementNote).toContain('collected the fare in person');
    expect(b.settlementNote).toContain('₱15.75');
  });

  it('says the payout lands in the wallet for prepaid errands', () => {
    const b = computeEarningsBreakdown(booking({ payment_method_type: 'gcash' }));
    expect(b.cashSettlement).toBeNull();
    expect(b.settlementNote).toContain('ErrandGuy wallet');
  });

  it('stays silent when the payload does not say how it was paid', () => {
    const b = computeEarningsBreakdown(booking());
    expect(b.settlementNote).toBeNull();
  });
});
