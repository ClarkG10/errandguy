import { CASH_DEBT_LIMIT_FALLBACK, cashDebtLimit, cashDebtMessage, cashDebtText } from '../cashDebt';
import { isLedgerCredit, signedLedgerAmount, ledgerIcon, LEDGER_ICONS } from '../walletLedger';
import { parseWalletSummary } from '../../services/payment.service';
import { spendableOnErrands } from '../../hooks/useWalletSummary';

jest.mock('../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../hooks/useQuery', () => ({ useQuery: jest.fn(), invalidateQuery: jest.fn() }));

describe('cashDebtMessage — word for word what CashDebtPolicy::message says', () => {
  it('names the amount, how it clears, and where cash work pauses', () => {
    expect(cashDebtMessage(-240)).toBe(
      'You owe ₱240.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,000.',
    );
    expect(cashDebtMessage(1234.5, 1500)).toBe(
      'You owe ₱1,234.50 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,500.',
    );
  });

  it('prints a fractional limit with centavos, and none when the block is off', () => {
    expect(cashDebtMessage(10, 999.5)).toMatch(/pause at ₱999\.50\.$/);
    expect(cashDebtMessage(10, 0)).toBe(
      'You owe ₱10.00 from cash errands. It’s cleared automatically from your next prepaid earnings.',
    );
  });

  it('never tells a runner to "settle" anything or that there is "nothing to pay"', () => {
    const text = cashDebtMessage(-500);
    expect(text).not.toMatch(/settle/i);
    expect(text).not.toMatch(/nothing to pay/i);
  });

  it('prefers the profile’s own cash_debt_block message', () => {
    const message = 'You owe ₱1,500.00 from cash errands. … cash errands pause at ₱1,200.';
    expect(cashDebtText(-1500, { cash_debt_block: { message } })).toBe(message);
    expect(cashDebtText(-100, { cash_debt_block: null })).toBe(cashDebtMessage(-100));
    expect(cashDebtText(-100)).toBe(cashDebtMessage(-100));
  });
});

/**
 * The pause point used to be a hard-coded ₱1,000 on every screen that only had
 * the balance. It now comes from the server (`cash_debt_limit` on the runner's
 * own profile and on GET /wallet/balance), with ₱1,000 left only for a server
 * that sends neither.
 */
describe('the cash-debt limit staff set', () => {
  it('reads cash_debt_limit off the payload, falling back to ₱1,000', () => {
    expect(cashDebtLimit({ cash_debt_limit: 1500 })).toBe(1500);
    expect(cashDebtLimit({ cash_debt_limit: '1750.50' })).toBe(1750.5);
    expect(cashDebtLimit({})).toBe(CASH_DEBT_LIMIT_FALLBACK);
    expect(cashDebtLimit(null)).toBe(CASH_DEBT_LIMIT_FALLBACK);
    expect(cashDebtLimit(undefined)).toBe(CASH_DEBT_LIMIT_FALLBACK);
    expect(cashDebtLimit({ cash_debt_limit: 'abc' })).toBe(CASH_DEBT_LIMIT_FALLBACK);
    expect(cashDebtLimit({ cash_debt_limit: -5 })).toBe(CASH_DEBT_LIMIT_FALLBACK);
  });

  it('keeps 0, which means the limit is off', () => {
    expect(cashDebtLimit({ cash_debt_limit: 0 })).toBe(0);
    expect(cashDebtMessage(100, cashDebtLimit({ cash_debt_limit: 0 }))).toBe(
      'You owe ₱100.00 from cash errands. It’s cleared automatically from your next prepaid earnings.',
    );
  });

  it('names the profile’s limit on a runner screen when there is no block yet', () => {
    expect(cashDebtText(-240, { cash_debt_block: null, cash_debt_limit: 2500 })).toBe(
      'You owe ₱240.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱2,500.',
    );
  });

  it('is carried through the wallet summary, and left out when the server sends none', () => {
    expect(parseWalletSummary({ balance: -240, cash_debt_limit: 1500 }).cash_debt_limit).toBe(1500);
    expect(parseWalletSummary({ balance: -240, cash_debt_limit: 0 }).cash_debt_limit).toBe(0);
    expect(parseWalletSummary({ balance: -240 })).not.toHaveProperty('cash_debt_limit');
    expect(parseWalletSummary({ balance: -240, cash_debt_limit: 'x' })).not.toHaveProperty('cash_debt_limit');
  });
});

describe('wallet ledger direction', () => {
  it('reads a cancellation fee as money in', () => {
    expect(isLedgerCredit({ type: 'cancel_fee', amount: 50 })).toBe(true);
    expect(signedLedgerAmount({ type: 'cancel_fee', amount: 50 })).toBe(50);
    expect(ledgerIcon('cancel_fee')).toBe(LEDGER_ICONS.cancel_fee);
  });

  it('reads a payout / withdrawal as money out, whatever sign it was stored with', () => {
    expect(signedLedgerAmount({ type: 'payout', amount: -250 })).toBe(-250);
    expect(signedLedgerAmount({ type: 'payout', amount: 250 })).toBe(-250);
  });

  it('lets the sign decide for signed types, coercing Laravel’s decimal strings', () => {
    expect(signedLedgerAmount({ type: 'tip', amount: '-20.00' as unknown as number })).toBe(-20);
    expect(signedLedgerAmount({ type: 'adjustment', amount: '15.5' as unknown as number })).toBe(15.5);
    expect(isLedgerCredit({ type: 'commission', amount: -12 })).toBe(false);
  });

  it('still draws legacy top-up and bonus rows, and anything unknown', () => {
    expect(isLedgerCredit({ type: 'top_up', amount: 100 })).toBe(true);
    expect(isLedgerCredit({ type: 'bonus', amount: 50 })).toBe(true);
    expect(ledgerIcon('something_new')).toBe(LEDGER_ICONS.payment);
  });
});

describe('parseWalletSummary — GET /wallet/balance', () => {
  it('reads balance, withdrawable and bonus credit as numbers', () => {
    expect(
      parseWalletSummary({ balance: '120.50', withdrawable: '120.50', bonus_balance: '30.00' }),
    ).toEqual({ balance: 120.5, withdrawable: 120.5, bonus_balance: 30 });
  });

  it('derives withdrawable from an older server that sends the balance alone', () => {
    expect(parseWalletSummary({ balance: 80 })).toEqual({
      balance: 80,
      withdrawable: 80,
      bonus_balance: 0,
    });
    // A runner in debt has nothing to withdraw.
    expect(parseWalletSummary({ balance: -40 }).withdrawable).toBe(0);
  });

  it('never yields NaN from a missing or broken payload', () => {
    expect(parseWalletSummary(undefined)).toEqual({ balance: 0, withdrawable: 0, bonus_balance: 0 });
    expect(parseWalletSummary({ balance: 'abc' })).toEqual({
      balance: 0,
      withdrawable: 0,
      bonus_balance: 0,
    });
  });

  it('keeps the server’s withdrawal minimum, and leaves it absent when unusable', () => {
    expect(parseWalletSummary({ balance: 500, withdraw_min: '100.00' }).withdraw_min).toBe(100);
    expect(parseWalletSummary({ balance: 500 })).not.toHaveProperty('withdraw_min');
    expect(parseWalletSummary({ balance: 500, withdraw_min: 0 })).not.toHaveProperty('withdraw_min');
    expect(parseWalletSummary({ balance: 500, withdraw_min: 'abc' })).not.toHaveProperty('withdraw_min');
  });
});

describe('spendableOnErrands', () => {
  it('is the balance plus bonus credit — what the server charges a booking against', () => {
    expect(spendableOnErrands({ balance: 50, withdrawable: 50, bonus_balance: 100 })).toBe(150);
    expect(spendableOnErrands({ balance: 0.1, withdrawable: 0.1, bonus_balance: 0.2 })).toBe(0.3);
  });
});
