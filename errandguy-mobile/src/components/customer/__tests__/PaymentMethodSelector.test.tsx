import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaymentMethodSelector } from '../PaymentMethodSelector';
import { useAuthStore } from '../../../stores/authStore';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { toast } from '../../../stores/toastStore';
import type { PaymentMethodType, User, WalletSummary } from '../../../types';

/**
 * The Review screen's payment picker for launch: cash, GCash, Maya and the
 * wallet — and the wallet only when its balance (bonus credit included, as the
 * server charges it) covers the errand, because there are no top-ups to fix a
 * short one. No cards, no GrabPay, no saved or linked accounts.
 */

let mockAvailable: Array<{ type: string }> | null = null;
jest.mock('../../../hooks/useQuery', () => ({
  useQuery: () => ({ data: mockAvailable, loading: false, error: null }),
  invalidateQuery: jest.fn(),
}));

let mockWallet: WalletSummary | null = null;
let mockWalletError: Error | null = null;
jest.mock('../../../hooks/useWalletSummary', () => ({
  ...jest.requireActual('../../../hooks/useWalletSummary'),
  useWalletSummary: () => ({ data: mockWallet, error: mockWalletError, loading: false }),
}));

jest.mock('../../../stores/toastStore', () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

/** A parent that owns the pick, like the Review screen's draft does. */
function Harness({
  initial,
  amount,
  onChange,
}: {
  initial?: PaymentMethodType;
  amount: number;
  onChange: (t: PaymentMethodType) => void;
}) {
  const [selected, setSelected] = React.useState<PaymentMethodType | undefined>(initial);
  return (
    <PaymentMethodSelector
      selected={selected}
      amount={amount}
      onSelect={(t) => {
        setSelected(t);
        onChange(t);
      }}
    />
  );
}

const renderSelector = (props: { initial?: PaymentMethodType; amount?: number } = {}) => {
  const onChange = jest.fn();
  const screen = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Harness initial={props.initial} amount={props.amount ?? 200} onChange={onChange} />
    </SafeAreaProvider>,
  );
  return { screen, onChange };
};

const openSheet = (screen: ReturnType<typeof render>) =>
  fireEvent.press(screen.getByLabelText(/^Payment method: .*\. Change$/));

/** The option rows in the sheet, by their accessibility label's first part. */
const optionLabels = (screen: ReturnType<typeof render>) =>
  ['ErrandGuy Wallet', 'GCash', 'Maya', 'Cash on Delivery', 'Credit / Debit Card', 'GrabPay'].filter(
    (name) => screen.queryAllByLabelText(new RegExp(`^${name.replace(/[/]/g, '\\/')}\\. `)).length > 0,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable = null;
  mockWallet = null;
  mockWalletError = null;
  useAuthStore.setState({ user: { id: 'c1' } as User, isAuthenticated: true });
  usePreferencesStore.setState({ isHydrated: true, lastPaymentMethods: {} });
});

describe('PaymentMethodSelector — what it offers', () => {
  it('offers cash, GCash and Maya — and the wallet when it covers the errand', async () => {
    mockWallet = { balance: 500, withdrawable: 500, bonus_balance: 0 };
    const { screen } = renderSelector({ amount: 200 });
    openSheet(screen);

    await waitFor(() =>
      expect(optionLabels(screen)).toEqual(['ErrandGuy Wallet', 'GCash', 'Maya', 'Cash on Delivery']),
    );
  });

  it('leaves the wallet out when its balance can’t cover the errand', async () => {
    mockWallet = { balance: 150, withdrawable: 150, bonus_balance: 0 };
    const { screen } = renderSelector({ amount: 200 });
    openSheet(screen);

    await waitFor(() => expect(optionLabels(screen)).toEqual(['GCash', 'Maya', 'Cash on Delivery']));
  });

  it('leaves the wallet out while the balance is unknown, and when it is empty', async () => {
    const unknown = renderSelector({ amount: 0 });
    openSheet(unknown.screen);
    expect(optionLabels(unknown.screen)).toEqual(['GCash', 'Maya', 'Cash on Delivery']);
    unknown.screen.unmount();

    mockWallet = { balance: 0, withdrawable: 0, bonus_balance: 0 };
    const empty = renderSelector({ amount: 0 });
    openSheet(empty.screen);
    expect(optionLabels(empty.screen)).toEqual(['GCash', 'Maya', 'Cash on Delivery']);
  });

  it('counts bonus credit toward an errand, and says it is there', async () => {
    // ₱50 balance + ₱100 bonus covers ₱120 — the server spends the bonus first.
    mockWallet = { balance: 50, withdrawable: 50, bonus_balance: 100 };
    const { screen } = renderSelector({ amount: 120 });
    openSheet(screen);

    await waitFor(() => expect(optionLabels(screen)).toContain('ErrandGuy Wallet'));
    expect(
      screen.getByLabelText('ErrandGuy Wallet. Balance ₱150.00 · includes ₱100.00 bonus credit'),
    ).toBeTruthy();
  });

  it('shows only what the operator has switched on', async () => {
    mockAvailable = [{ type: 'gcash' }, { type: 'cash' }];
    mockWallet = { balance: 500, withdrawable: 500, bonus_balance: 0 };
    const { screen } = renderSelector();
    openSheet(screen);

    await waitFor(() => expect(optionLabels(screen)).toEqual(['GCash', 'Cash on Delivery']));
  });

  it('never offers a card or GrabPay, even if an older server lists them', async () => {
    mockAvailable = [{ type: 'card' }, { type: 'grabpay' }, { type: 'gcash' }, { type: 'cash' }];
    const { screen } = renderSelector();
    openSheet(screen);

    await waitFor(() => expect(optionLabels(screen)).toEqual(['GCash', 'Cash on Delivery']));
  });

  it('picks a method from the sheet', async () => {
    const { screen, onChange } = renderSelector();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cash'));
    openSheet(screen);

    fireEvent.press(screen.getByLabelText(/^Maya\. /));

    expect(onChange).toHaveBeenLastCalledWith('maya');
  });
});

describe('PaymentMethodSelector — the default pick', () => {
  it('defaults a fresh draft to cash', async () => {
    const { onChange } = renderSelector();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cash'));
  });

  it('pre-selects how this account last paid', async () => {
    usePreferencesStore.setState({
      lastPaymentMethods: { c1: { type: 'gcash', savedAt: 1 } },
    });
    const { onChange } = renderSelector();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('gcash'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a wallet regular gets the wallet when it covers the errand, cash when it can’t', async () => {
    usePreferencesStore.setState({ lastPaymentMethods: { c1: { type: 'wallet', savedAt: 1 } } });
    mockWallet = { balance: 500, withdrawable: 500, bonus_balance: 0 };
    const covered = renderSelector({ amount: 200 });
    await waitFor(() => expect(covered.onChange).toHaveBeenCalledWith('wallet'));
    covered.screen.unmount();

    mockWallet = { balance: 20, withdrawable: 20, bonus_balance: 0 };
    const short = renderSelector({ amount: 200 });
    await waitFor(() => expect(short.onChange).toHaveBeenCalledWith('cash'));
    expect(short.onChange).not.toHaveBeenCalledWith('wallet');
  });

  it('waits for the balance before choosing for a wallet regular', async () => {
    usePreferencesStore.setState({ lastPaymentMethods: { c1: { type: 'wallet', savedAt: 1 } } });
    const { onChange } = renderSelector();
    // Balance still loading — no snap to Cash that would then hop.
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a pick the draft already holds', async () => {
    const { onChange } = renderSelector({ initial: 'maya' });
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('PaymentMethodSelector — a pick that can no longer be used', () => {
  it('moves a restored wallet pick off a balance that can’t cover it, and says so', async () => {
    mockWallet = { balance: 30, withdrawable: 30, bonus_balance: 0 };
    const { onChange } = renderSelector({ initial: 'wallet', amount: 200 });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cash'));
    expect(toast.info).toHaveBeenCalledWith(
      'Your wallet balance can’t cover this errand — switched to Cash on Delivery',
    );
  });

  it('moves a pick the operator has switched off, and says so', async () => {
    mockAvailable = [{ type: 'maya' }, { type: 'cash' }];
    const { onChange } = renderSelector({ initial: 'gcash' });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cash'));
    expect(toast.info).toHaveBeenCalledWith(
      'GCash isn’t available right now — switched to Cash on Delivery',
    );
  });
});
