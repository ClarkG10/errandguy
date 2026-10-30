import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import WithdrawScreen from '../withdraw';
import { paymentService } from '../../../../services/payment.service';
import { useAuthStore } from '../../../../stores/authStore';
import type { User, WalletSummary } from '../../../../types';

/**
 * The customer's money-OUT flow. What has to hold, because a withdrawal debits
 * the wallet the moment the server accepts it:
 *   • every request carries an Idempotency-Key (the server 428s without one);
 *   • a double-tap sends ONE request;
 *   • a failure whose outcome is unknown keeps the key, so the retry replays
 *     the first withdrawal instead of debiting a second time — and a definitive
 *     refusal or a changed withdrawal gets a fresh one;
 *   • the server's refusals (not enough balance, money owed from cash errands)
 *     are shown in its own words.
 */

let mockKeySeq = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockKeySeq}` }));

jest.mock('../../../../services/payment.service', () => ({
  paymentService: { withdraw: jest.fn() },
}));

let mockSummary: WalletSummary | null = { balance: 500, withdrawable: 500, bonus_balance: 0 };
const mockRefreshSummary = jest.fn();
jest.mock('../../../../hooks/useWalletSummary', () => ({
  useWalletSummary: () => ({
    data: mockSummary,
    loading: false,
    error: null,
    refresh: mockRefreshSummary,
  }),
}));

const mockWithdraw = paymentService.withdraw as jest.Mock;
const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true };

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <WithdrawScreen />
    </SafeAreaProvider>,
  );

/** Amount, GCash, number — the account name is pre-filled from the profile. */
const fillForm = (
  screen: ReturnType<typeof renderScreen>,
  amount = '250',
  number = '0917 123-4567',
) => {
  fireEvent.changeText(screen.getByLabelText('Amount'), amount);
  fireEvent.press(screen.getByLabelText('GCash'));
  fireEvent.changeText(screen.getByLabelText('GCash number'), number);
};

/** The Confirm button inside the "Withdraw ₱…?" dialog. */
const confirmButton = (screen: ReturnType<typeof renderScreen>) => {
  const buttons = screen.getAllByRole('button', { name: 'Withdraw' });
  return buttons[buttons.length - 1];
};

const reviewAndConfirm = async (screen: ReturnType<typeof renderScreen>, amountLabel = '₱250.00') => {
  fireEvent.press(screen.getByRole('button', { name: `Withdraw ${amountLabel}` }));
  await waitFor(() => expect(screen.getByText(`Withdraw ${amountLabel}?`)).toBeTruthy());
  await act(async () => {
    fireEvent.press(confirmButton(screen));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockKeySeq = 0;
  mockSummary = { balance: 500, withdrawable: 500, bonus_balance: 0 };
  (useRouter as jest.Mock).mockReturnValue(mockRouter);
  useAuthStore.setState({
    user: { id: 'c1', full_name: 'Rina Cruz' } as User,
    role: 'customer',
    isAuthenticated: true,
  });
  mockWithdraw.mockResolvedValue({
    data: {
      data: { id: 'tx-1', type: 'payout', status: 'pending', amount: -250 },
      message: 'Withdrawal of ₱250.00 to GCash •••• 4567 requested.',
    },
  });
});

describe('withdraw — the request', () => {
  it('sends the normalized destination with an Idempotency-Key, then returns to the wallet', async () => {
    const screen = renderScreen();
    fillForm(screen);

    await reviewAndConfirm(screen);

    expect(mockWithdraw).toHaveBeenCalledTimes(1);
    expect(mockWithdraw).toHaveBeenCalledWith(
      {
        amount: 250,
        channel: 'gcash',
        // Spaces and dashes stripped: the server checks the number as sent.
        account_number: '09171234567',
        account_name: 'Rina Cruz',
      },
      { idempotencyKey: 'key-1' },
    );
    // Back to the wallet, where the pending payout now heads the history.
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('a double-tap on Confirm sends ONE request', async () => {
    let resolve!: (v: unknown) => void;
    mockWithdraw.mockReturnValue(new Promise((r) => (resolve = r)));
    const screen = renderScreen();
    fillForm(screen);
    fireEvent.press(screen.getByRole('button', { name: 'Withdraw ₱250.00' }));
    await waitFor(() => expect(screen.getByText('Withdraw ₱250.00?')).toBeTruthy());

    // A press that lands while the button is already busy bubbles to the
    // dialog body, which swallows it (stopPropagation).
    const tap = { stopPropagation: () => {} };
    const confirm = confirmButton(screen);
    fireEvent.press(confirm, tap);
    fireEvent.press(confirm, tap);
    fireEvent.press(confirm, tap);

    expect(mockWithdraw).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ data: { data: { id: 'tx-1' }, message: 'ok' } });
    });
  });
});

describe('withdraw — the Idempotency-Key across retries', () => {
  it('keeps the key after a timeout, so the retry replays the same withdrawal', async () => {
    mockWithdraw.mockRejectedValueOnce({ status: 0, kind: 'timeout' });
    const screen = renderScreen();
    fillForm(screen);

    await reviewAndConfirm(screen);
    await reviewAndConfirm(screen);

    expect(mockWithdraw).toHaveBeenCalledTimes(2);
    expect(mockWithdraw.mock.calls[0][1]).toEqual({ idempotencyKey: 'key-1' });
    expect(mockWithdraw.mock.calls[1][1]).toEqual({ idempotencyKey: 'key-1' });
  });

  it('keeps it on a 409 (the first request is still running) and a 5xx', async () => {
    mockWithdraw
      .mockRejectedValueOnce({ status: 409, kind: 'conflict' })
      .mockRejectedValueOnce({ status: 503, kind: 'server' });
    const screen = renderScreen();
    fillForm(screen);

    await reviewAndConfirm(screen);
    await reviewAndConfirm(screen);
    await reviewAndConfirm(screen);

    expect(mockWithdraw.mock.calls.map((c) => c[1].idempotencyKey)).toEqual([
      'key-1',
      'key-1',
      'key-1',
    ]);
  });

  it('mints a new key for a changed withdrawal — the server would refuse the old one', async () => {
    mockWithdraw.mockRejectedValueOnce({ status: 0, kind: 'offline' });
    const screen = renderScreen();
    fillForm(screen);
    await reviewAndConfirm(screen);

    fireEvent.changeText(screen.getByLabelText('Amount'), '200');
    await reviewAndConfirm(screen, '₱200.00');

    expect(mockWithdraw.mock.calls[0][1]).toEqual({ idempotencyKey: 'key-1' });
    expect(mockWithdraw.mock.calls[1][1]).toEqual({ idempotencyKey: 'key-2' });
  });

  it('drops the key after a definitive refusal, and shows the server’s reason', async () => {
    const refusal =
      'You requested ₱250.00 but your available balance is ₱120.00. Lower the amount and try again.';
    mockWithdraw.mockRejectedValueOnce({
      status: 422,
      kind: 'validation',
      code: 'INSUFFICIENT_WALLET_BALANCE',
      message: refusal,
    });
    const screen = renderScreen();
    fillForm(screen);

    await reviewAndConfirm(screen);
    await waitFor(() => expect(screen.getByText(refusal)).toBeTruthy());
    // The balance moved under us — re-read it.
    expect(mockRefreshSummary).toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();

    await reviewAndConfirm(screen);
    expect(mockWithdraw.mock.calls[1][1]).toEqual({ idempotencyKey: 'key-2' });
  });
});

describe('withdraw — refusals and validation', () => {
  it('shows money owed from cash errands in the server’s own words', async () => {
    const owed =
      'You owe ₱300.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,000.';
    mockWithdraw.mockRejectedValueOnce({
      status: 422,
      kind: 'validation',
      code: 'CASH_DEBT_OUTSTANDING',
      message: owed,
    });
    const screen = renderScreen();
    fillForm(screen);

    await reviewAndConfirm(screen);

    await waitFor(() => expect(screen.getByText(owed)).toBeTruthy());
  });

  it('shows the server’s field errors under the inputs', async () => {
    mockWithdraw.mockRejectedValueOnce({
      status: 422,
      kind: 'validation',
      code: 'VALIDATION_FAILED',
      message: 'The given data was invalid.',
      errors: { account_name: ['Enter the account holder’s name.'] },
    });
    const screen = renderScreen();
    fillForm(screen);

    await reviewAndConfirm(screen);

    await waitFor(() =>
      expect(screen.getAllByText('Enter the account holder’s name.').length).toBeGreaterThan(0),
    );
  });

  it('never sends a number that is not a PH mobile number', () => {
    const screen = renderScreen();
    fillForm(screen, '250', '12345');

    fireEvent.press(screen.getByRole('button', { name: 'Withdraw ₱250.00' }));

    expect(screen.getByText('Enter the GCash mobile number, e.g. 09171234567.')).toBeTruthy();
    expect(screen.queryByText('Withdraw ₱250.00?')).toBeNull();
    expect(mockWithdraw).not.toHaveBeenCalled();
  });

  it('never asks for more than can be withdrawn', () => {
    const screen = renderScreen();
    fillForm(screen, '900');

    fireEvent.press(screen.getByRole('button', { name: 'Withdraw ₱900.00' }));

    expect(screen.getByText('That\'s more than the ₱500.00 you can withdraw.')).toBeTruthy();
    expect(mockWithdraw).not.toHaveBeenCalled();
  });
});

describe('withdraw — what can go out', () => {
  it('keeps bonus credit out of it, and says so', () => {
    mockSummary = { balance: 120, withdrawable: 120, bonus_balance: 50 };
    const screen = renderScreen();

    expect(screen.getByText('₱120.00')).toBeTruthy();
    expect(
      screen.getByText(/Your ₱50\.00 bonus credit stays in your wallet — spend it on errands/),
    ).toBeTruthy();
  });

  it('with nothing withdrawable, explains instead of offering the form', () => {
    mockSummary = { balance: 0, withdrawable: 0, bonus_balance: 0 };
    const screen = renderScreen();

    expect(screen.getByText(/There’s nothing to withdraw yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Amount')).toBeNull();
  });
});
