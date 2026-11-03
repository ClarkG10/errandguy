import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeleteAccountSheet } from '../DeleteAccountSheet';
import { userService } from '../../../services/user.service';

/**
 * Deleting an account with money in it. The server never strands a balance:
 * the first DELETE answers PAYOUT_METHOD_REQUIRED (naming the amount), the
 * sheet asks where to send it and deletes again WITH those details, and the
 * success says where the money is going. Money owed from cash errands refuses
 * outright, in the server's own words.
 */

jest.mock('../../../services/user.service', () => ({
  userService: { deleteAccount: jest.fn() },
}));

let mockBonus = 0;
jest.mock('../../../hooks/useWalletSummary', () => ({
  useWalletSummary: () => ({
    data: { balance: 0, withdrawable: 0, bonus_balance: mockBonus },
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

const mockDelete = userService.deleteAccount as jest.Mock;

const NEEDS_DESTINATION = {
  status: 422,
  kind: 'validation',
  code: 'PAYOUT_METHOD_REQUIRED',
  message:
    'Your wallet has ₱80.00. Tell us where to send it — a GCash or Maya number — and we’ll send it to you as part of deleting your account.',
  errors: { channel: ['Choose where to send your remaining balance.'] },
};

const renderSheet = (props: Partial<React.ComponentProps<typeof DeleteAccountSheet>> = {}) => {
  const onDeleted = jest.fn();
  const onClose = jest.fn();
  const screen = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <DeleteAccountSheet
        visible
        onClose={onClose}
        description="This can't be undone."
        allowBank={false}
        onDeleted={onDeleted}
        {...props}
      />
    </SafeAreaProvider>,
  );
  return { screen, onDeleted, onClose };
};

const typeDeleteAndConfirm = async (screen: ReturnType<typeof render>) => {
  fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm account deletion'), 'DELETE');
  await act(async () => {
    // By label: the backdrop (also a button) contains this text, so a role
    // query would match both.
    fireEvent.press(screen.getByLabelText('Delete Account'));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockBonus = 0;
});

describe('DeleteAccountSheet — typing DELETE', () => {
  it('accepts it in any case, with stray spaces', async () => {
    mockDelete.mockResolvedValue({ data: { data: null, message: 'Account deleted successfully.' } });
    const { screen, onDeleted } = renderSheet();

    fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm account deletion'), ' delete ');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete Account'));
    });

    expect(mockDelete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('still refuses anything else', async () => {
    const { screen } = renderSheet();

    fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm account deletion'), 'delet');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete Account'));
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('DeleteAccountSheet — bonus credit', () => {
  it('warns, before deleting, that bonus credit is lost with the account', () => {
    mockBonus = 50;
    const { screen } = renderSheet();

    expect(screen.getByText(/₱50\.00 bonus credit can’t be sent to you/)).toBeTruthy();
  });

  it('says nothing about it when there is none', () => {
    const { screen } = renderSheet();

    expect(screen.queryByText(/bonus credit/)).toBeNull();
  });
});

describe('DeleteAccountSheet — an empty wallet', () => {
  it('deletes straight away and signs out', async () => {
    mockDelete.mockResolvedValue({ data: { data: null, message: 'Account deleted successfully.' } });
    const { screen, onDeleted } = renderSheet();

    await typeDeleteAndConfirm(screen);

    expect(mockDelete).toHaveBeenCalledWith(undefined);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('links the public deletion page', () => {
    const { screen } = renderSheet();

    expect(screen.getByRole('link', { name: 'Delete your account on the web' })).toBeTruthy();
  });
});

describe('DeleteAccountSheet — money in the wallet (PAYOUT_METHOD_REQUIRED)', () => {
  it('asks where to send it, resends WITH the details, then says where it went', async () => {
    mockDelete.mockRejectedValueOnce(NEEDS_DESTINATION).mockResolvedValueOnce({
      data: {
        data: {
          payout: { id: 'p1', amount: 80, status: 'pending', destination: 'Maya •••• 2222' },
        },
        message:
          'Account deleted. ₱80.00 is on its way to Maya •••• 2222 — it usually arrives within 1–3 business days.',
      },
    });
    const { screen, onDeleted } = renderSheet();

    await typeDeleteAndConfirm(screen);

    // The server's own sentence (with the amount) leads the question.
    await waitFor(() => expect(screen.getByText(NEEDS_DESTINATION.message)).toBeTruthy());
    expect(screen.getByText('Where should we send your balance?')).toBeTruthy();
    // A customer chooses GCash or Maya — no bank.
    expect(screen.getByLabelText('GCash')).toBeTruthy();
    expect(screen.getByLabelText('Maya')).toBeTruthy();
    expect(screen.queryByLabelText('Bank account')).toBeNull();

    fireEvent.press(screen.getByLabelText('Maya'));
    fireEvent.changeText(screen.getByLabelText('Maya number'), '+63 918 111 2222');
    fireEvent.changeText(screen.getByLabelText('Account holder’s name'), 'Rina Cruz');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send it & delete account'));
    });

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete.mock.calls[1][0]).toEqual({
      channel: 'maya',
      account_number: '+639181112222',
      account_name: 'Rina Cruz',
    });
    // Where the money is going, before the account is signed out of.
    await waitFor(() =>
      expect(screen.getByText(/₱80\.00 is on its way to Maya •••• 2222/)).toBeTruthy(),
    );
    expect(onDeleted).not.toHaveBeenCalled();
    // …and how to chase it once there is no account left to look in.
    expect(screen.getByText('support@errandguyph.com')).toBeTruthy();
    expect(screen.getByText('Reference: p1')).toBeTruthy();
    expect(screen.getByText(/we can’t notify you when it’s sent/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Done'));
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('lets an account with a runner profile send it to a bank', async () => {
    mockDelete.mockRejectedValueOnce(NEEDS_DESTINATION).mockResolvedValueOnce({
      data: { data: { payout: { id: 'p1', amount: 80, status: 'pending', destination: 'BDO •••• 7890' } }, message: 'Account deleted.' },
    });
    const { screen } = renderSheet({ allowBank: true });

    await typeDeleteAndConfirm(screen);
    await waitFor(() => expect(screen.getByLabelText('Bank account')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Bank account'));
    fireEvent.press(screen.getByLabelText('BDO'));
    fireEvent.changeText(screen.getByLabelText('Account number'), '0012-3456-7890');
    fireEvent.changeText(screen.getByLabelText('Account holder’s name'), 'Juan Dela Cruz');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send it & delete account'));
    });

    expect(mockDelete.mock.calls[1][0]).toEqual({
      channel: 'bank',
      account_number: '001234567890',
      account_name: 'Juan Dela Cruz',
      bank_name: 'BDO',
    });
  });

  it('checks the details before sending them', async () => {
    mockDelete.mockRejectedValueOnce(NEEDS_DESTINATION);
    const { screen } = renderSheet();
    await typeDeleteAndConfirm(screen);
    await waitFor(() => expect(screen.getByLabelText('GCash')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('GCash'));
    fireEvent.changeText(screen.getByLabelText('GCash number'), '555');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send it & delete account'));
    });

    expect(screen.getByText('Enter the GCash mobile number, e.g. 09171234567.')).toBeTruthy();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe('DeleteAccountSheet — refusals', () => {
  it('shows money owed from cash errands clearly, and does not delete', async () => {
    const owed =
      'You owe ₱450.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,000. You can delete your account once it’s cleared.';
    mockDelete.mockRejectedValueOnce({
      status: 422,
      kind: 'validation',
      code: 'CASH_DEBT_OUTSTANDING',
      message: owed,
    });
    const { screen, onDeleted } = renderSheet({ allowBank: true });

    await typeDeleteAndConfirm(screen);

    await waitFor(() => expect(screen.getByText(owed)).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
    // Still on the confirm step — nothing to send anywhere.
    expect(screen.getByText('Delete your account?')).toBeTruthy();
  });

  it('shows an errand-in-progress refusal (a 422 with no code) in the server’s words', async () => {
    const busy = 'You have an active errand. Finish or cancel it before deleting your account.';
    mockDelete.mockRejectedValueOnce({ status: 422, kind: 'validation', message: busy });
    const { screen, onDeleted } = renderSheet();

    await typeDeleteAndConfirm(screen);

    await waitFor(() => expect(screen.getByText(busy)).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
