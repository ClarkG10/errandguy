import { DEFAULT_WITHDRAW_MIN, withdrawAmountProblem, withdrawMinimum } from '../withdrawal';

describe('withdrawal minimum', () => {
  it('prefers the server figure, else ₱100', () => {
    expect(withdrawMinimum({ withdraw_min: 250 })).toBe(250);
    expect(withdrawMinimum({})).toBe(DEFAULT_WITHDRAW_MIN);
    expect(withdrawMinimum(null)).toBe(100);
    expect(withdrawMinimum({ withdraw_min: 0 })).toBe(100);
  });

  it('names the problem with an amount, or none', () => {
    expect(withdrawAmountProblem(0, 500, 100)).toBe('Enter at least ₱100.00 to withdraw.');
    expect(withdrawAmountProblem(99.99, 500, 100)).toBe('The minimum withdrawal is ₱100.00.');
    expect(withdrawAmountProblem(600, 500, 100)).toBe("That's more than the ₱500.00 you can withdraw.");
    expect(withdrawAmountProblem(100, 500, 100)).toBeNull();
    expect(withdrawAmountProblem(500, 500, 100)).toBeNull();
    // Balance still loading: only the floor can be judged.
    expect(withdrawAmountProblem(150, null, 100)).toBeNull();
  });
});
