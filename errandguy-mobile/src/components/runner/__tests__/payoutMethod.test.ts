import {
  PAYOUT_MIN_FALLBACK,
  PH_BANKS,
  isKnownBank,
  maskedAccount,
  payoutMinimum,
  resolvePayoutMethod,
  type SelfRunnerProfile,
} from '../payoutMethod';

const profile = (over: Partial<SelfRunnerProfile> = {}): SelfRunnerProfile =>
  ({
    bank_name: null,
    bank_account_number: null,
    bank_account_last4: null,
    ewallet_number: null,
    payout_minimum: null,
    ...over,
  }) as SelfRunnerProfile;

describe('payoutMinimum', () => {
  it('falls back to 100 when the server value is missing', () => {
    expect(payoutMinimum(null)).toBe(PAYOUT_MIN_FALLBACK);
    expect(payoutMinimum(profile())).toBe(100);
  });

  it('uses the server value when present', () => {
    expect(payoutMinimum(profile({ payout_minimum: 250 }))).toBe(250);
    // Laravel decimal casts can arrive as strings.
    expect(payoutMinimum(profile({ payout_minimum: '50' as unknown as number }))).toBe(50);
  });

  it('never returns 0 — a 0 floor would un-gate the button into server 422s', () => {
    expect(payoutMinimum(profile({ payout_minimum: 0 }))).toBe(100);
    expect(payoutMinimum(profile({ payout_minimum: -10 }))).toBe(100);
    expect(payoutMinimum(profile({ payout_minimum: NaN }))).toBe(100);
  });
});

describe('resolvePayoutMethod', () => {
  it('blocks with no_method when nothing is saved', () => {
    const m = resolvePayoutMethod(profile());
    expect(m.ready).toBe(false);
    expect(m.blocker).toBe('no_method');
    expect(m.destination).toBeNull();
  });

  it('accepts an e-wallet number on its own (server: e-wallet alone is sendable)', () => {
    const m = resolvePayoutMethod(profile({ ewallet_number: '09171234567' }));
    expect(m.ready).toBe(true);
    expect(m.blocker).toBeNull();
    expect(m.destination).toBe('your e-wallet');
  });

  it('rejects a bank name with no account number — the exact server rule', () => {
    const m = resolvePayoutMethod(profile({ bank_name: 'BPI' }));
    expect(m.ready).toBe(false);
    expect(m.blocker).toBe('incomplete_bank');
    expect(m.bankName).toBe('BPI');
  });

  it('rejects an account number with no bank name', () => {
    const m = resolvePayoutMethod(profile({ bank_account_last4: '4321' }));
    expect(m.ready).toBe(false);
    expect(m.blocker).toBe('no_method');
  });

  it('accepts a complete bank pair', () => {
    const m = resolvePayoutMethod(profile({ bank_name: 'BDO', bank_account_last4: '1234' }));
    expect(m.ready).toBe(true);
    expect(m.destination).toBe('your BDO account');
    expect(m.bankLast4).toBe('1234');
  });

  it('names the e-wallet first when both are saved — the server resolves it that way', () => {
    const m = resolvePayoutMethod(
      profile({ bank_name: 'BDO', bank_account_last4: '1234', ewallet_number: '09171234567' }),
    );
    expect(m.destination).toBe('your e-wallet');
  });

  it('treats whitespace-only values as absent', () => {
    const m = resolvePayoutMethod(profile({ bank_name: '   ', ewallet_number: '  ' }));
    expect(m.ready).toBe(false);
    expect(m.blocker).toBe('no_method');
  });
});

describe('bank picker helpers', () => {
  it('recognises the fixed PH bank list case-insensitively', () => {
    expect(isKnownBank('bdo')).toBe(true);
    expect(isKnownBank('  Security Bank ')).toBe(true);
    expect(isKnownBank('Some Rural Bank')).toBe(false);
    expect(isKnownBank(null)).toBe(false);
  });

  it('exposes the banks the finding asked for', () => {
    expect(PH_BANKS).toEqual([
      'BDO',
      'BPI',
      'Metrobank',
      'Landbank',
      'UnionBank',
      'PNB',
      'RCBC',
      'Security Bank',
      'Chinabank',
      'EastWest',
    ]);
  });

  it('masks an account without ever showing more than the last 4', () => {
    expect(maskedAccount('1234')).toBe('•••• 1234');
    expect(maskedAccount(null)).toBeNull();
    expect(maskedAccount('')).toBeNull();
  });
});
