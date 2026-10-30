import {
  PAYOUT_MIN_FALLBACK,
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
    payout_channel: null,
    payout_account_name: null,
    ...over,
  }) as SelfRunnerProfile;

describe('payoutMinimum', () => {
  it('falls back to the server default when the profile has none', () => {
    expect(payoutMinimum(null)).toBe(PAYOUT_MIN_FALLBACK);
    expect(payoutMinimum(profile())).toBe(100);
  });

  it('reads the server value, coercing a decimal string', () => {
    expect(payoutMinimum(profile({ payout_minimum: 250 }))).toBe(250);
    expect(payoutMinimum(profile({ payout_minimum: '50' as unknown as number }))).toBe(50);
  });

  it('never lets a zero / negative / NaN floor un-gate the button', () => {
    expect(payoutMinimum(profile({ payout_minimum: 0 }))).toBe(100);
    expect(payoutMinimum(profile({ payout_minimum: -10 }))).toBe(100);
    expect(payoutMinimum(profile({ payout_minimum: NaN }))).toBe(100);
  });
});

describe('resolvePayoutMethod — a method saved with an explicit channel', () => {
  it('names a GCash method with the last four digits and the holder', () => {
    const m = resolvePayoutMethod(
      profile({
        payout_channel: 'gcash',
        ewallet_number: '09171234567',
        payout_account_name: 'Juan Dela Cruz',
      }),
    );
    expect(m).toMatchObject({
      ready: true,
      blocker: null,
      channel: 'gcash',
      label: 'GCash •••• 4567',
      accountName: 'Juan Dela Cruz',
      needsChannel: false,
    });
  });

  it('names a Maya method', () => {
    const m = resolvePayoutMethod(profile({ payout_channel: 'maya', ewallet_number: '+639181112222' }));
    expect(m.label).toBe('Maya •••• 2222');
    expect(m.ready).toBe(true);
  });

  it('names a bank method by the bank and its masked account', () => {
    const m = resolvePayoutMethod(
      profile({ payout_channel: 'bank', bank_name: 'BDO', bank_account_last4: '1234' }),
    );
    expect(m).toMatchObject({ ready: true, channel: 'bank', label: 'BDO •••• 1234', bankName: 'BDO' });
  });

  it('follows the channel, not the leftovers: a bank method ignores an e-wallet number', () => {
    // Saving a method clears the other channel server-side, but the label must
    // never be built from the wrong one regardless.
    const m = resolvePayoutMethod(
      profile({
        payout_channel: 'bank',
        bank_name: 'BPI',
        bank_account_last4: '9876',
        ewallet_number: '09171234567',
      }),
    );
    expect(m.label).toBe('BPI •••• 9876');
  });

  it('a bank method without a readable account number is incomplete', () => {
    const m = resolvePayoutMethod(profile({ payout_channel: 'bank', bank_name: 'BPI' }));
    expect(m).toMatchObject({ ready: false, blocker: 'incomplete_bank', label: null });
  });

  it('an e-wallet channel with no number is no method at all', () => {
    const m = resolvePayoutMethod(profile({ payout_channel: 'gcash' }));
    expect(m).toMatchObject({ ready: false, blocker: 'no_method' });
  });
});

describe('resolvePayoutMethod — a method saved by an older app build (no channel)', () => {
  it('reports no method on an empty profile', () => {
    const m = resolvePayoutMethod(profile());
    expect(m).toMatchObject({ ready: false, blocker: 'no_method', label: null });
  });

  it('an e-wallet number alone is sendable, but asks whether it is GCash or Maya', () => {
    const m = resolvePayoutMethod(profile({ ewallet_number: '09171234567' }));
    expect(m).toMatchObject({
      ready: true,
      channel: null,
      label: 'E-wallet •••• 4567',
      needsChannel: true,
    });
  });

  it('the e-wallet number wins over a bank account, as on the server', () => {
    const m = resolvePayoutMethod(
      profile({ ewallet_number: '09171234567', bank_name: 'BDO', bank_account_last4: '1234' }),
    );
    expect(m.label).toBe('E-wallet •••• 4567');
  });

  it('a complete bank is sendable; a bank name alone is incomplete', () => {
    expect(
      resolvePayoutMethod(profile({ bank_name: 'BDO', bank_account_last4: '1234' })).label,
    ).toBe('BDO •••• 1234');
    expect(resolvePayoutMethod(profile({ bank_name: 'BPI' })).blocker).toBe('incomplete_bank');
    // An account number with no bank name can't be sent either.
    expect(resolvePayoutMethod(profile({ bank_account_last4: '4321' })).blocker).toBe('no_method');
  });

  it('treats whitespace-only fields as empty', () => {
    const m = resolvePayoutMethod(profile({ bank_name: '   ', ewallet_number: '  ' }));
    expect(m).toMatchObject({ ready: false, blocker: 'no_method' });
  });
});
