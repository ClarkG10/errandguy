import React from 'react';
import { RefreshControl } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import WalletActivityScreen from '../activity';
import { useAuthStore } from '../../../../stores/authStore';
import { paymentService } from '../../../../services/payment.service';
import { userService } from '../../../../services/user.service';
import type { User } from '../../../../types';

jest.mock('../../../../services/payment.service', () => ({
  paymentService: { getWalletTransactions: jest.fn() },
}));
jest.mock('../../../../services/user.service', () => ({
  userService: { getProfile: jest.fn() },
}));
// useQuery persists page 1 through cache.service; the screen's balance hero is
// what's under test, so keep the ledger fetch a plain pass-through.
jest.mock('../../../../hooks/useQuery', () => {
  // Required inside the factory: jest.mock is hoisted above the imports.
  const r: typeof React = require('react');
  return {
    useQuery: (_key: unknown, fetcher: () => Promise<unknown>) => {
      const [data, setData] = r.useState<unknown>(undefined);
      const run = r.useCallback(async () => {
        setData(await fetcher());
      }, []);
      r.useEffect(() => {
        void run();
      }, [run]);
      return { data, loading: false, error: null, refresh: run, isStale: false, updatedAt: null };
    },
    invalidateQuery: jest.fn(),
  };
});

const mockGetProfile = userService.getProfile as jest.Mock;
const mockGetTransactions = paymentService.getWalletTransactions as jest.Mock;

/** Runner whose wallet_balance in the store predates the commission debit. */
const staleUser = { id: 'r1', role: 'runner', wallet_balance: 500 } as unknown as User;
/** What GET /user/profile actually returns once the debit has settled. */
const freshUser = { ...staleUser, wallet_balance: 485 } as User;

const profileResponse = () => ({ data: { data: { ...freshUser } } });

// useSafeAreaInsets throws outside a provider; supply static metrics.
const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <WalletActivityScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProfile.mockResolvedValue(profileResponse());
  mockGetTransactions.mockResolvedValue({
    data: {
      data: [
        {
          id: 'tx1',
          type: 'commission',
          amount: -15,
          balance_after: 485,
          status: 'completed',
          created_at: '2026-08-28T10:00:00Z',
        },
      ],
    },
  });
  useAuthStore.setState({ user: staleUser, role: 'runner', isAuthenticated: true });
});

describe('runner wallet activity balance hero', () => {
  it('refreshes wallet_balance on mount so the hero matches the ledger below it', async () => {
    const { getByText } = renderScreen();

    // Nothing but setUser ever writes wallet_balance — without a mount fetch
    // the hero keeps rendering the pre-debit ₱500.00 above a row ending at 485.
    await waitFor(() => expect(mockGetProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByText('₱485.00')).toBeTruthy());
  });

  it('refreshes wallet_balance on pull-to-refresh, not just the rows', async () => {
    const { UNSAFE_getAllByType, getByText } = renderScreen();
    await waitFor(() => expect(mockGetProfile).toHaveBeenCalledTimes(1));

    // A later debit lands while the screen is open — the runner pulls exactly
    // to see it.
    mockGetProfile.mockResolvedValue({
      data: { data: { ...freshUser, wallet_balance: 470 } },
    });
    const [refreshControl] = UNSAFE_getAllByType(RefreshControl);
    await act(async () => {
      await refreshControl.props.onRefresh();
    });

    expect(mockGetProfile).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(getByText('₱470.00')).toBeTruthy());
  });
});
