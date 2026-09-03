import fs from 'fs';
import path from 'path';
import { formatDuration } from '../ShiftSummarySheet';

/**
 * The shift summary card.
 *
 * A runner used to clock off into silence — to find out what they'd just earned
 * they had to open the earnings tab and reason about which rows belonged to the
 * hours they'd worked.
 *
 * The duration formatter is real logic and is tested as such. The money
 * HONESTY is the part that actually matters and is guarded by source shape:
 * `earnings` is payout only and tips are a separate line, matching the earnings
 * screen, the CSV and the PDF statement. A card that quietly folded tips into
 * the headline would disagree with the very screen the runner checks next.
 */
describe('formatDuration', () => {
  it('reads in hours and minutes, the way a shift is actually thought about', () => {
    expect(formatDuration(380)).toBe('6h 20m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(60)).toBe('1h');
  });

  it('never renders a fractional hour', () => {
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(90)).not.toContain('.');
  });

  it('survives the values a flaky clock can produce', () => {
    // A shift summary must never render "NaNm" at someone who just worked.
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-5)).toBe('0m');
    expect(formatDuration(NaN)).toBe('0m');
    expect(formatDuration(Infinity)).toBe('0m');
  });

  it('rounds rather than truncating to a wrong minute', () => {
    expect(formatDuration(59.6)).toBe('1h');
  });
});

describe('money honesty', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'ShiftSummarySheet.tsx'),
    'utf8',
  );

  it('puts payout alone in the headline', () => {
    // Never `earnings + tips`. runner_payout is what the cash-settlement
    // commission maths and the PDF statement reconcile against.
    expect(source).toContain('formatCurrency(shift?.earnings ?? 0)');
    expect(source).not.toMatch(/earnings\s*\+\s*[a-z]*tips/i);
  });

  it('shows tips as their own line, and only when there are any', () => {
    expect(source).toMatch(/shift\.tips > 0/);
    expect(source).toContain('formatCurrency(shift.tips)');
  });

  it('renders nothing when the server could not measure the shift', () => {
    // A null shift means "we cannot say honestly", not "you earned zero" — a
    // zeroed card would read like a bad day the runner did not have.
    expect(source).toContain('isVisible={!!shift}');
  });
});
