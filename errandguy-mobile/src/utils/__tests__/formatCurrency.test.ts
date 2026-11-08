import { formatCurrency } from '../formatCurrency';

describe('formatCurrency', () => {
  it('formats pesos with two decimals and grouping', () => {
    expect(formatCurrency(1234.5)).toBe('₱1,234.50');
    expect(formatCurrency(0)).toBe('₱0.00');
  });

  it('puts the minus before the peso sign', () => {
    // A runner's balance after a cash commission read "Bal ₱-12.22".
    expect(formatCurrency(-12.22)).toBe('−₱12.22');
    expect(formatCurrency(-1500)).toBe('−₱1,500.00');
  });

  it('never signs an amount that rounds to zero', () => {
    expect(formatCurrency(-0.001)).toBe('₱0.00');
    expect(formatCurrency(-0)).toBe('₱0.00');
  });

  it('falls back to zero for anything that is not a number', () => {
    expect(formatCurrency(NaN)).toBe('₱0.00');
    expect(formatCurrency('abc' as unknown as number)).toBe('₱0.00');
  });
});
