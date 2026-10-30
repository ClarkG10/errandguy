import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import PayoutScreen from '../index';
import { useAuthStore } from '../../../../stores/authStore';
import { useRunnerStore } from '../../../../stores/runnerStore';
import { runnerService } from '../../../../services/runner.service';
import { userService } from '../../../../services/user.service';
import type { RunnerProfile, User } from '../../../../types';

/**
 * The runner's payout method: ONE explicit destination — GCash, Maya or a
 * bank account — saved through PUT /runner/payout-method, changeable and
 * removable, and named wherever the runner is told where the money goes.
 */

jest.mock('../../../../services/runner.service', () => ({
  runnerService: {
    getRunnerProfile: jest.fn(),
    savePayoutMethod: jest.fn(),
    removePayoutMethod: jest.fn(),
    requestPayout: jest.fn(),
    getPayoutHistory: jest.fn(),
  },
}));
jest.mock('../../../../services/user.service', () => ({
  userService: { getProfile: jest.fn() },
}));
jest.mock('../../../../services/payment.service', () => ({
  paymentService: { getWalletTransactions: jest.fn() },
}));
jest.mock('../../../../hooks/useQuery', () => ({
  useQuery: () => ({ data: [], loading: false, error: null, refresh: jest.fn() }),
  invalidateQuery: jest.fn(),
}));

const mockGetRunnerProfile = runnerService.getRunnerProfile as jest.Mock;
const mockSave = runnerService.savePayoutMethod as jest.Mock;
const mockRemove = runnerService.removePayoutMethod as jest.Mock;

const runner = { id: 'r1', full_name: 'Juan Dela Cruz', wallet_balance: 500 } as unknown as User;

const profile = (over: Record<string, unknown> = {}) =>
  ({
    id: 'p1',
    user_id: 'r1',
    bank_name: null,
    bank_account_last4: null,
    ewallet_number: null,
    payout_channel: null,
    payout_account_name: null,
    payout_minimum: 100,
    ...over,
  }) as unknown as RunnerProfile;

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <PayoutScreen />
    </SafeAreaProvider>,
  );

const startWith = (p: RunnerProfile, user: User = runner) => {
  useRunnerStore.setState({ runnerProfile: p });
  useAuthStore.setState({ user, role: 'runner', isAuthenticated: true });
  mockGetRunnerProfile.mockResolvedValue({ data: { data: p } });
  (userService.getProfile as jest.Mock).mockResolvedValue({ data: { data: user } });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('payout method — none saved yet', () => {
  it('asks where payouts go and saves an explicit GCash method', async () => {
    startWith(profile());
    const saved = profile({
      payout_channel: 'gcash',
      ewallet_number: '09171234567',
      payout_account_name: 'Juan Dela Cruz',
    });
    mockSave.mockResolvedValue({
      data: { data: saved, message: 'Payout method saved: GCash •••• 4567.' },
    });
    const screen = renderScreen();

    expect(screen.getByText('Where should we send your payouts?')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('GCash'));
    fireEvent.changeText(screen.getByLabelText('GCash number'), '0917-123-4567');
    // The holder's name starts as the runner's own.
    expect(screen.getByDisplayValue('Juan Dela Cruz')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save payout method'));
    });

    expect(mockSave).toHaveBeenCalledWith({
      channel: 'gcash',
      account_number: '09171234567',
      account_name: 'Juan Dela Cruz',
    });
    // The saved profile comes straight back from the endpoint — and the mount
    // refresh that was already in flight (answering with NO method) must not
    // overwrite it when it lands after the save.
    await waitFor(() => expect(screen.getByText('GCash •••• 4567')).toBeTruthy());
    expect(screen.getByText('Payouts go to')).toBeTruthy();
    expect(useRunnerStore.getState().runnerProfile).toBe(saved);
  });

  it('saves a bank with its name, and the account number as digits', async () => {
    startWith(profile());
    mockSave.mockResolvedValue({
      data: {
        data: profile({ payout_channel: 'bank', bank_name: 'BPI', bank_account_last4: '6789' }),
        message: 'Payout method saved: BPI •••• 6789.',
      },
    });
    const screen = renderScreen();

    fireEvent.press(screen.getByLabelText('Bank account'));
    fireEvent.press(screen.getByLabelText('BPI'));
    fireEvent.changeText(screen.getByLabelText('Account number'), '1234 5678 9');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save payout method'));
    });

    expect(mockSave).toHaveBeenCalledWith({
      channel: 'bank',
      account_number: '123456789',
      account_name: 'Juan Dela Cruz',
      bank_name: 'BPI',
    });
    await waitFor(() => expect(screen.getByText('BPI •••• 6789')).toBeTruthy());
  });

  it('checks the details before saving', async () => {
    startWith(profile());
    const screen = renderScreen();

    fireEvent.press(screen.getByLabelText('Maya'));
    fireEvent.changeText(screen.getByLabelText('Maya number'), '0917');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save payout method'));
    });

    expect(screen.getByText('Enter the Maya mobile number, e.g. 09171234567.')).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('pre-selects a bank saved without its account number, asking only for the number', () => {
    startWith(profile({ bank_name: 'BPI' }));
    const screen = renderScreen();

    expect(screen.getByText('Finish your BPI payout details')).toBeTruthy();
    expect(screen.getByLabelText('Bank account').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByLabelText('BPI').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('Account number').props.value).toBe('');
  });
});

describe('payout method — one saved', () => {
  const gcash = profile({
    payout_channel: 'gcash',
    ewallet_number: '09171234567',
    payout_account_name: 'Juan Dela Cruz',
  });

  it('says where payouts go, including on the request confirmation', async () => {
    startWith(gcash);
    const screen = renderScreen();

    expect(screen.getByText('GCash •••• 4567')).toBeTruthy();
    expect(screen.queryByLabelText('Save payout method')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Amount to withdraw'), '200');
    fireEvent.press(screen.getByLabelText('Request Payout'));
    await waitFor(() =>
      expect(screen.getByText(/Funds will be transferred to GCash •••• 4567/)).toBeTruthy(),
    );
  });

  it('changes it: the form opens pre-filled and saves the new one', async () => {
    startWith(gcash);
    mockSave.mockResolvedValue({
      data: {
        data: profile({ payout_channel: 'maya', ewallet_number: '09181112222' }),
        message: 'Payout method saved: Maya •••• 2222.',
      },
    });
    const screen = renderScreen();

    fireEvent.press(screen.getByLabelText('Change'));
    expect(screen.getByDisplayValue('09171234567')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Maya'));
    fireEvent.changeText(screen.getByLabelText('Maya number'), '09181112222');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save payout method'));
    });

    expect(mockSave).toHaveBeenCalledWith({
      channel: 'maya',
      account_number: '09181112222',
      account_name: 'Juan Dela Cruz',
    });
    await waitFor(() => expect(screen.getByText('Maya •••• 2222')).toBeTruthy());
  });

  it('removes it after a confirmation, and asks for one again', async () => {
    startWith(gcash);
    mockRemove.mockResolvedValue({
      data: { data: profile(), message: 'Payout method removed.' },
    });
    const screen = renderScreen();

    fireEvent.press(screen.getByLabelText('Remove'));
    await waitFor(() => expect(screen.getByText('Remove payout method?')).toBeTruthy());
    // The summary's Remove opened the dialog; the dialog's own Remove confirms.
    const removes = screen.getAllByLabelText('Remove');
    await act(async () => {
      fireEvent.press(removes[removes.length - 1], { stopPropagation: () => {} });
    });

    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText('Where should we send your payouts?')).toBeTruthy(),
    );
  });

  it('asks a runner whose number predates the channel whether it is GCash or Maya', () => {
    startWith(profile({ ewallet_number: '09171234567' }));
    const screen = renderScreen();

    expect(screen.getByText('E-wallet •••• 4567')).toBeTruthy();
    expect(
      screen.getByText('Is this number GCash or Maya? Update it so your payouts go the right way.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Update')).toBeTruthy();
  });
});

describe('payout screen — money owed from cash errands', () => {
  it('uses the server’s sentence, never "nothing to pay separately"', () => {
    startWith(profile(), { ...runner, wallet_balance: -240 } as User);
    const screen = renderScreen();

    expect(
      screen.getByText(
        'You owe ₱240.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,000.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/nothing to pay separately/)).toBeNull();
  });

  it('prefers the profile’s own cash_debt_block message once over the limit', () => {
    const message =
      'You owe ₱1,500.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,200.';
    startWith(
      profile({ cash_debt_block: { owed: 1500, limit: 1200, message } }),
      { ...runner, wallet_balance: -1500 } as User,
    );
    const screen = renderScreen();

    expect(screen.getByText(message)).toBeTruthy();
  });
});
