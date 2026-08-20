import { formatRunnerPayout } from '../runnerPayout';

describe('formatRunnerPayout', () => {
  it('formats a known numeric payout as currency', () => {
    expect(formatRunnerPayout(150)).toBe('₱150.00');
    expect(formatRunnerPayout(0)).toBe('₱0.00');
    expect(formatRunnerPayout(1234.5)).toBe('₱1,234.50');
  });

  it('coerces a Laravel decimal-string payout before formatting', () => {
    // runner_payout arrives as a JSON string ("14.60") from the decimal cast.
    expect(formatRunnerPayout('14.60' as unknown as number)).toBe('₱14.60');
  });

  it('shows the pending label (never total_amount) when payout is unknown', () => {
    expect(formatRunnerPayout(null)).toBe('Payout pending');
    expect(formatRunnerPayout(undefined)).toBe('Payout pending');
  });

  it('honors a custom pending label (e.g. "—" for cancelled history rows)', () => {
    expect(formatRunnerPayout(null, '—')).toBe('—');
    expect(formatRunnerPayout(undefined, 'No payout')).toBe('No payout');
  });

  it('treats a real 0 payout as an amount, not as pending', () => {
    // Guards against a truthiness regression (0 must NOT fall through to the
    // pending label — it is a legitimate, known payout).
    expect(formatRunnerPayout(0, 'Payout pending')).toBe('₱0.00');
  });
});
