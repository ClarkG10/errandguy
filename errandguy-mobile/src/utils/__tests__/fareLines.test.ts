import { fareLines } from '../fareLines';

const amounts = (lines: { amount: number }[]) => lines.map((l) => l.amount);
const labels = (lines: { label: string }[]) => lines.map((l) => l.label);

describe('fareLines — the four base rows', () => {
  it('reads an estimate (plain numbers) and adds no discount row', () => {
    const lines = fareLines({ base_fee: 50, distance_fee: 30, service_fee: 15.75, surcharge: 0 });
    expect(labels(lines)).toEqual(['Base Fee', 'Distance Fee', 'Convenience Fee', 'Surcharge']);
    expect(amounts(lines)).toEqual([50, 30, 15.75, 0]);
  });

  it('reads a booking, whose decimal:2 money arrives as JSON strings', () => {
    // BookingResource sends "50.00", not 50. Treating that as 0 printed every
    // receipt row as ₱0.00 under a correct total.
    const lines = fareLines({
      base_fee: '50.00',
      distance_fee: '30.00',
      service_fee: '15.75',
      surcharge: '0.00',
    });
    expect(amounts(lines)).toEqual([50, 30, 15.75, 0]);
  });

  it('renders a missing or garbage component as 0 rather than NaN', () => {
    const lines = fareLines({ base_fee: null, distance_fee: undefined, service_fee: 'abc' });
    expect(amounts(lines)).toEqual([0, 0, 0, 0]);
  });

  it('has nothing to show without a fare', () => {
    expect(fareLines(null)).toEqual([]);
    expect(fareLines(undefined, 10)).toEqual([]);
  });
});

/**
 * Promo codes are retired, so this row is history: only a booking made while
 * they existed carries a saving, and its receipt must keep showing it or the
 * rows stop adding up to what that customer was charged.
 */
describe('fareLines — the discount row on older promo-code bookings', () => {
  const fare = { base_fee: '50.00', distance_fee: '30.00', service_fee: '15.75', surcharge: '0.00' };

  it('keeps the discount an older booking carries, as a negative line', () => {
    const lines = fareLines(fare, '10.00');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toEqual({ label: 'Promo Discount', amount: -10 });
  });

  it.each([
    ['a new booking (0.00 from the API)', '0.00'],
    ['a zero number', 0],
    ['a null', null],
    ['an absent value', undefined],
    ['a negative value', -5],
  ])('shows no discount row for %s', (_label, discount) => {
    const lines = fareLines(fare, discount);
    expect(labels(lines)).not.toContain('Promo Discount');
    expect(lines).toHaveLength(4);
  });
});
