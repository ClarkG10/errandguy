import React from 'react';
import { SectionList } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WalletScreen from '../index';
import { paymentService } from '../../../../services/payment.service';
import { useAuthStore } from '../../../../stores/authStore';
import { useWalletStore } from '../../../../stores/walletStore';
import type { User, WalletSummary, WalletTransaction } from '../../../../types';

/**
 * The wallet used to show only the newest 20 transactions — older refunds and
 * withdrawals were unreachable. It pages now, like the runner's ledger. And
 * the hero no longer offers ₱40 "to withdraw" when the minimum is ₱100.
 */

jest.mock('../../../../services/payment.service', () => ({
  paymentService: {
    getWalletBalance: jest.fn(),
    getWalletTransactions: jest.fn(),
  },
}));

let mockSummary: WalletSummary = { balance: 40, withdrawable: 40, bonus_balance: 0, withdraw_min: 100 };
jest.mock('../../../../hooks/useWalletSummary', () => ({
  useWalletSummary: () => ({
    data: mockSummary,
    loading: false,
    error: null,
    isStale: false,
    refresh: jest.fn(),
  }),
}));

const mockBalance = paymentService.getWalletBalance as jest.Mock;
const mockTx = paymentService.getWalletTransactions as jest.Mock;

const tx = (n: number): WalletTransaction =>
  ({
    id: `tx-${n}`,
    user_id: 'c1',
    type: 'refund',
    amount: 10,
    balance_after: 40,
    status: 'completed',
    description: 'Refund',
    display_description: `Refund for Delivery #EG-${n}`,
    created_at: new Date(Date.now() - n * 60_000).toISOString(),
  }) as unknown as WalletTransaction;

const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => tx(from + i));

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <WalletScreen />
    </SafeAreaProvider>,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSummary = { balance: 40, withdrawable: 40, bonus_balance: 0, withdraw_min: 100 };
  (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), back: jest.fn(), replace: jest.fn() });
  useAuthStore.setState({ user: { id: 'c1', full_name: 'Rina Cruz' } as User, isAuthenticated: true });
  useWalletStore.setState({ balance: 0, transactions: [] });
  mockBalance.mockResolvedValue({ data: { data: { balance: 40 } } });
});

describe('wallet history', () => {
  it('loads older transactions as you scroll, then says it has shown them all', async () => {
    mockTx
      .mockResolvedValueOnce({ data: { data: page(1, 20) } })
      .mockResolvedValueOnce({ data: { data: page(21, 5) } });
    const screen = renderScreen();

    await waitFor(() => expect(screen.getByText('Refund for Delivery #EG-1')).toBeTruthy());
    expect(mockTx).toHaveBeenLastCalledWith({ page: 1, per_page: 20 });

    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(SectionList), 'onEndReached');
    });

    expect(mockTx).toHaveBeenLastCalledWith({ page: 2, per_page: 20 });
    await waitFor(() => expect(screen.getByText('That’s your full wallet history.')).toBeTruthy());
  });

  it('shows a row once even when new activity shifts the server’s pages between loads', async () => {
    const pageOf = (from: number) => ({ data: { data: page(from, 20) } });
    // Pages 2 and 3 overlap by one row: something landed while scrolling.
    mockTx
      .mockResolvedValueOnce(pageOf(1))
      .mockResolvedValueOnce(pageOf(21))
      .mockResolvedValueOnce(pageOf(40));
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText('Refund for Delivery #EG-1')).toBeTruthy());

    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(SectionList), 'onEndReached');
    });
    await waitFor(() => expect(mockTx).toHaveBeenLastCalledWith({ page: 2, per_page: 20 }));
    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(SectionList), 'onEndReached');
    });
    await waitFor(() => expect(mockTx).toHaveBeenLastCalledWith({ page: 3, per_page: 20 }));

    // Read the list's data, not the drawn rows (only the first screenful renders).
    await waitFor(() => {
      const ids = (screen.UNSAFE_getByType(SectionList).props.sections as { data: WalletTransaction[] }[])
        .flatMap((sec) => sec.data.map((t) => t.id));
      expect(ids).toHaveLength(59);
      expect(new Set(ids).size).toBe(59);
    });
  });

  it('offers a retry when an older page fails, instead of silently stopping', async () => {
    mockTx
      .mockResolvedValueOnce({ data: { data: page(1, 20) } })
      .mockRejectedValueOnce({ status: 0, kind: 'offline' });
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText('Refund for Delivery #EG-1')).toBeTruthy());

    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(SectionList), 'onEndReached');
    });

    await waitFor(() => expect(screen.getByText('Couldn’t load more transactions.')).toBeTruthy());
  });

  it('names the wallet-paid filter for what it shows', async () => {
    mockTx.mockResolvedValue({ data: { data: [] } });
    const screen = renderScreen();
    expect(screen.getByLabelText('Filter transactions: Paid from wallet')).toBeTruthy();
    expect(screen.queryByLabelText('Filter transactions: Payments')).toBeNull();
  });
});

describe('the withdraw minimum', () => {
  it('does not offer an amount below it as withdrawable', async () => {
    mockTx.mockResolvedValue({ data: { data: [] } });
    const screen = renderScreen();

    await waitFor(() =>
      expect(
        screen.getByText('You can withdraw to GCash or Maya once you have ₱100.00 or more'),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/₱40\.00 can be withdrawn/)).toBeNull();
  });

  it('shows the withdrawable amount once it reaches the minimum', async () => {
    mockSummary = { balance: 150, withdrawable: 150, bonus_balance: 0, withdraw_min: 100 };
    mockBalance.mockResolvedValue({ data: { data: { balance: 150 } } });
    mockTx.mockResolvedValue({ data: { data: [] } });
    const screen = renderScreen();

    await waitFor(() =>
      expect(screen.getByText('₱150.00 can be withdrawn to GCash or Maya')).toBeTruthy(),
    );
  });
});

describe('money owed from cash errands', () => {
  // An account that is also a runner can owe from cash errands. The sentence
  // under the balance names where cash work pauses — the figure staff set, as
  // GET /wallet/balance now reports it, not a ₱1,000 baked into the app.
  it('names the pause point the server reports', async () => {
    mockSummary = { balance: -240, withdrawable: 0, bonus_balance: 0, withdraw_min: 100, cash_debt_limit: 1500 };
    mockBalance.mockResolvedValue({ data: { data: { balance: -240 } } });
    mockTx.mockResolvedValue({ data: { data: [] } });
    const screen = renderScreen();

    await waitFor(() =>
      expect(
        screen.getByText(
          'You owe ₱240.00 from cash errands. It’s cleared automatically from your next prepaid earnings; cash errands pause at ₱1,500.',
        ),
      ).toBeTruthy(),
    );
  });

  it('keeps ₱1,000 when an older server sends no limit', async () => {
    mockSummary = { balance: -240, withdrawable: 0, bonus_balance: 0, withdraw_min: 100 };
    mockBalance.mockResolvedValue({ data: { data: { balance: -240 } } });
    mockTx.mockResolvedValue({ data: { data: [] } });
    const screen = renderScreen();

    await waitFor(() => expect(screen.getByText(/cash errands pause at ₱1,000\.$/)).toBeTruthy());
  });
});
