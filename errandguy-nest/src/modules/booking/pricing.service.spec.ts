import { PricingService } from './pricing.service';

/**
 * PARITY TESTS — the NestJS money math must produce the SAME numbers as the
 * Laravel production backend (both run on the same Supabase DB, so any drift
 * corrupts shared money data). The expected values below are the canonical
 * outputs of Laravel's App\Services\PricingService for identical inputs:
 *
 *   subtotal      = base_fee + vehicle_premium + distance_fee
 *   service_fee   = round(subtotal * platform_fee_percent%, 2)   // 15%
 *   total_amount  = round(subtotal + service_fee + surcharge, 2)
 *   runner_payout = round(total_amount - service_fee, 2)          // clamped >= 0
 *   VEHICLE_BASE_PREMIUM = { walk:0, bicycle:10, motorcycle:25, car:60 }
 *
 * If someone changes the Nest formula/premiums, these fail — catching the
 * float-vs-Decimal / formula drift the audit flagged as the #1 risk.
 */
describe('PricingService (money parity with Laravel)', () => {
  const errandType = {
    id: 'et1',
    baseFee: 50,
    surcharge: 0,
    perKmWalk: 15,
    perKmBicycle: 12,
    perKmMotorcycle: 10,
    perKmCar: 18,
    minNegotiateFee: 30,
  };

  const prisma = {
    errandType: { findUnique: jest.fn().mockResolvedValue(errandType) },
  } as any;
  const config = { getValue: jest.fn().mockResolvedValue('15') } as any;
  // remember() just runs the loader, so the prisma mock above still drives the
  // ErrandType lookup (P20 added the cached accessor to PricingService).
  const cache = { remember: jest.fn((_key: string, cb: () => unknown) => cb()) } as any;

  const service = new PricingService(prisma, config, cache);

  it('prices a zero-distance motorcycle errand exactly like Laravel', async () => {
    // subtotal = 50 + 25 (motorcycle) + 0 = 75
    // service_fee = 15% * 75 = 11.25 ; total = 75 + 11.25 = 86.25 ; payout = 75
    const p = await service.calculate('et1', 14.5995, 120.9842, null, null, 'motorcycle');

    expect(p.base_fee).toBe(50);
    expect(p.vehicle_premium).toBe(25);
    expect(p.distance_fee).toBe(0);
    expect(p.service_fee).toBe(11.25);
    expect(p.total_amount).toBe(86.25);
    expect(p.runner_payout).toBe(75);
  });

  it('applies the canonical vehicle premiums (walk/bicycle/motorcycle/car = 0/10/25/60)', async () => {
    const expected: Record<string, number> = { walk: 0, bicycle: 10, motorcycle: 25, car: 60 };
    for (const [vehicle, premium] of Object.entries(expected)) {
      const p = await service.calculate('et1', 0, 0, null, null, vehicle);
      expect(p.vehicle_premium).toBe(premium);
    }
  });

  it('keeps service_fee = 15% of subtotal and runner_payout = total − service_fee', async () => {
    const p = await service.calculate('et1', 0, 0, null, null, 'car');
    const subtotal = p.base_fee + p.vehicle_premium + p.distance_fee;

    expect(p.service_fee).toBeCloseTo(subtotal * 0.15, 2);
    expect(p.runner_payout).toBeCloseTo(p.total_amount - p.service_fee, 2);
    // car: subtotal = 50 + 60 = 110 → fee 16.5, total 126.5, payout 110
    expect(p.total_amount).toBe(126.5);
    expect(p.service_fee).toBe(16.5);
    expect(p.runner_payout).toBe(110);
  });

  it('never returns a negative runner payout', async () => {
    const zeroFee = { ...errandType, baseFee: 0, perKmMotorcycle: 0 };
    prisma.errandType.findUnique.mockResolvedValueOnce(zeroFee);
    // walk premium 0 + base 0 + distance 0 → subtotal 0 → total 0, payout clamps at 0
    const p = await service.calculate('et1', 0, 0, null, null, 'walk');
    expect(p.runner_payout).toBeGreaterThanOrEqual(0);
  });

  describe('applyNegotiateOffer (H11 parity)', () => {
    it('makes the offer the total and gives the runner offer − flat service fee', async () => {
      const fixed = await service.calculate('et1', 0, 0, null, null, 'motorcycle');
      // motorcycle zero-distance: subtotal 75, service_fee 11.25
      const negotiated = service.applyNegotiateOffer(fixed, 200);

      expect(negotiated.total_amount).toBe(200);
      expect(negotiated.service_fee).toBe(fixed.service_fee); // flat fee unchanged
      expect(negotiated.runner_payout).toBe(Math.round((200 - fixed.service_fee) * 100) / 100);
      expect(negotiated.runner_payout).toBe(188.75);
    });

    it('never returns a negative runner payout when the offer is below the fee', async () => {
      const fixed = await service.calculate('et1', 0, 0, null, null, 'motorcycle');
      const negotiated = service.applyNegotiateOffer(fixed, 0.01);
      expect(negotiated.runner_payout).toBeGreaterThanOrEqual(0);
    });
  });

  describe('applyPromo', () => {
    it('percentage discount', () => {
      expect(service.applyPromo(100, { discount_type: 'percentage', discount_value: 10 }))
        .toEqual({ discount: 10, discounted_total: 90 });
    });

    it('fixed discount', () => {
      expect(service.applyPromo(100, { discount_type: 'fixed', discount_value: 30 }))
        .toEqual({ discount: 30, discounted_total: 70 });
    });

    it('caps at max_discount', () => {
      expect(service.applyPromo(100, { discount_type: 'percentage', discount_value: 50, max_discount: 20 }))
        .toEqual({ discount: 20, discounted_total: 80 });
    });

    it('never discounts more than the subtotal', () => {
      expect(service.applyPromo(40, { discount_type: 'fixed', discount_value: 100 }))
        .toEqual({ discount: 40, discounted_total: 0 });
    });
  });
});
