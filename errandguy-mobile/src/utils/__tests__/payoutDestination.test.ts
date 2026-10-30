import {
  EMPTY_PAYOUT_DESTINATION,
  PH_BANKS,
  knownBank,
  maskedDestination,
  payoutDestinationServerErrors,
  toPayoutDestinationPayload,
  validatePayoutDestination,
  type PayoutDestinationDraft,
} from '../payoutDestination';

const draft = (over: Partial<PayoutDestinationDraft>): PayoutDestinationDraft => ({
  ...EMPTY_PAYOUT_DESTINATION,
  accountName: 'Rina Cruz',
  ...over,
});

const EWALLET_ONLY = ['gcash', 'maya'] as const;
const ALL = ['gcash', 'maya', 'bank'] as const;

describe('validatePayoutDestination — mirrors App\\Support\\PayoutDestination::rules', () => {
  it('needs a channel the flow allows', () => {
    expect(validatePayoutDestination(draft({}), EWALLET_ONLY).channel).toBe(
      'Choose where to send the money: GCash or Maya.',
    );
    // A customer can't withdraw to a bank.
    expect(
      validatePayoutDestination(draft({ channel: 'bank' }), EWALLET_ONLY).channel,
    ).toBeDefined();
    expect(validatePayoutDestination(draft({}), ALL).channel).toBe(
      'Choose where to send the money: GCash, Maya or a bank account.',
    );
  });

  // Every spelling of a PH mobile is accepted, because it is SENT as
  // +639XXXXXXXXX (toPayoutDestinationPayload) — the shape the server's
  // /^(\+63|0)9\d{9}$/ rule takes.
  it.each(['09171234567', '+639171234567', '0917 123 4567', '0917-123-4567', '639171234567', '+63 917 123 4567'])(
    'accepts the PH mobile number %s for an e-wallet',
    (accountNumber) => {
      expect(validatePayoutDestination(draft({ channel: 'gcash', accountNumber }), EWALLET_ONLY)).toEqual({});
    },
  );

  it.each(['', '0917123456', '08171234567', '+63917123456', '6391712345678', 'abc'])(
    'rejects %p as a GCash / Maya number',
    (accountNumber) => {
      expect(
        validatePayoutDestination(draft({ channel: 'maya', accountNumber }), EWALLET_ONLY)
          .account_number,
      ).toBe('Enter the Maya mobile number, e.g. 09171234567.');
    },
  );

  it('a bank needs 6–20 digits and the bank’s name', () => {
    expect(
      validatePayoutDestination(
        draft({ channel: 'bank', accountNumber: '0012-3456-7890', bankName: 'BDO' }),
        ALL,
      ),
    ).toEqual({});
    const errors = validatePayoutDestination(
      draft({ channel: 'bank', accountNumber: '12345', bankName: ' ' }),
      ALL,
    );
    expect(errors.account_number).toBeDefined();
    expect(errors.bank_name).toBeDefined();
  });

  it('always needs the account holder’s name', () => {
    expect(
      validatePayoutDestination(
        draft({ channel: 'gcash', accountNumber: '09171234567', accountName: '  ' }),
        EWALLET_ONLY,
      ).account_name,
    ).toBe('Enter the account holder’s name.');
  });
});

describe('toPayoutDestinationPayload', () => {
  it('sends an e-wallet number as +639XXXXXXXXX, and no bank name', () => {
    expect(
      toPayoutDestinationPayload(
        draft({ channel: 'gcash', accountNumber: ' 0917 123-4567 ', bankName: 'BDO' }),
      ),
    ).toEqual({ channel: 'gcash', account_number: '+639171234567', account_name: 'Rina Cruz' });
    expect(
      toPayoutDestinationPayload(draft({ channel: 'maya', accountNumber: '+63 917 123 4567' }))
        .account_number,
    ).toBe('+639171234567');
  });

  it('sends a bank account as digits with its bank', () => {
    expect(
      toPayoutDestinationPayload(
        draft({ channel: 'bank', accountNumber: '0012-3456 7890', bankName: ' BPI ' }),
      ),
    ).toEqual({
      channel: 'bank',
      account_number: '001234567890',
      account_name: 'Rina Cruz',
      bank_name: 'BPI',
    });
  });
});

describe('the bank list', () => {
  it('names banks exactly as the server’s channel-code table does', () => {
    // A picked bank then resolves to its Xendit channel on its own
    // (PayoutDestination::bankChannelCode matches on these labels).
    expect(PH_BANKS).toEqual([
      'BDO',
      'BPI',
      'Metrobank',
      'Landbank',
      'UnionBank',
      'PNB',
      'RCBC',
      'Security Bank',
      'China Bank',
      'EastWest',
    ]);
  });

  it('matches a saved bank name case-insensitively', () => {
    expect(knownBank('bdo')).toBe('BDO');
    expect(knownBank('  Security Bank ')).toBe('Security Bank');
    expect(knownBank('Some Rural Bank')).toBeNull();
    expect(knownBank(null)).toBeNull();
  });
});

describe('maskedDestination', () => {
  it('shows only the last four digits, like the server’s label', () => {
    expect(maskedDestination('gcash', '09171234567')).toBe('GCash •••• 4567');
    expect(maskedDestination('maya', '+639181112222')).toBe('Maya •••• 2222');
    expect(maskedDestination('bank', '001234567890', 'BDO')).toBe('BDO •••• 7890');
    expect(maskedDestination(null, '09171234567')).toBeNull();
    expect(maskedDestination('gcash', '')).toBeNull();
  });
});

describe('payoutDestinationServerErrors', () => {
  it('takes the first message per field from a 422', () => {
    expect(
      payoutDestinationServerErrors({
        errors: {
          account_number: ['Enter the GCash or Maya mobile number, e.g. 09171234567.', 'x'],
          amount: ['ignored'],
        },
      }),
    ).toEqual({ account_number: 'Enter the GCash or Maya mobile number, e.g. 09171234567.' });
    expect(payoutDestinationServerErrors(null)).toEqual({});
  });
});
