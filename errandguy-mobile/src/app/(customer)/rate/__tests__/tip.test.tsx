import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import RateScreen from '../[bookingId]';
import { bookingService } from '../../../../services/booking.service';
import { openCheckoutUrl } from '../../../../utils/browser';
import { usePaymentStore } from '../../../../stores/paymentStore';
import type { WalletSummary } from '../../../../types';

/**
 * Tipping after an errand: from the wallet (only when its withdrawable balance
 * covers the tip), or a one-time GCash / Maya checkout — never a card. The
 * checkout is money in flight, so it carries an Idempotency-Key that survives
 * an unknown outcome and replays instead of charging twice.
 */

let mockKeySeq = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockKeySeq}` }));

jest.mock('../../../../services/booking.service', () => ({
  bookingService: { getBooking: jest.fn(), tip: jest.fn(), tipCheckout: jest.fn() },
}));
jest.mock('../../../../utils/browser', () => ({
  openCheckoutUrl: jest.fn(),
  PAYMENT_RETURN_URL: 'errandguy://payment-complete',
}));
jest.mock('../../../../hooks/usePaymentVerification', () => ({
  usePaymentVerification: () => ({ attempt: null, stage: null, isOffline: false }),
}));
let mockWallet: WalletSummary | null = null;
jest.mock('../../../../hooks/useWalletSummary', () => ({
  useWalletSummary: () => ({ data: mockWallet, error: null, loading: false }),
}));

const mockGetBooking = bookingService.getBooking as jest.Mock;
const mockTip = bookingService.tip as jest.Mock;
const mockTipCheckout = bookingService.tipCheckout as jest.Mock;
const mockOpenCheckout = openCheckoutUrl as jest.Mock;

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <RateScreen />
    </SafeAreaProvider>,
  );

const tipChips = (screen: ReturnType<typeof renderScreen>) =>
  screen.queryAllByLabelText(/^Pay tip with /).map((n) => n.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  mockKeySeq = 0;
  mockWallet = { balance: 0, withdrawable: 0, bonus_balance: 0 };
  usePaymentStore.setState({ attempt: null, isHydrated: true });
  (useLocalSearchParams as jest.Mock).mockReturnValue({ bookingId: 'b1' });
  mockGetBooking.mockResolvedValue({
    data: {
      data: {
        id: 'b1',
        booking_number: 'EG-1',
        total_amount: 180,
        runner: { id: 'r1', full_name: 'Juan Dela Cruz' },
      },
    },
  });
  mockTipCheckout.mockResolvedValue({
    data: { data: { id: 'tx-1' }, checkout_url: 'https://checkout.example/x' },
  });
  mockOpenCheckout.mockResolvedValue('cancelled');
});

describe('tip — how it can be paid', () => {
  it('offers GCash and Maya — never a card — when the wallet can’t cover it', async () => {
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Tip 50 pesos')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Tip 50 pesos'));

    expect(tipChips(screen)).toEqual(['Pay tip with GCash', 'Pay tip with Maya']);
  });

  it('adds the wallet, picked by default, when its withdrawable balance covers the tip', async () => {
    // Bonus credit never pays for a tip — only the withdrawable balance counts.
    mockWallet = { balance: 100, withdrawable: 100, bonus_balance: 500 };
    mockTip.mockResolvedValue({ data: {} });
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Tip 100 pesos')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Tip 100 pesos'));
    expect(tipChips(screen)).toEqual([
      'Pay tip with Wallet',
      'Pay tip with GCash',
      'Pay tip with Maya',
    ]);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send ₱100 tip'));
    });

    expect(mockTip).toHaveBeenCalledWith('b1', 100);
    expect(mockTipCheckout).not.toHaveBeenCalled();
  });
});

describe('tip — GCash / Maya checkout', () => {
  it('sends tip-checkout with an Idempotency-Key and the chosen method', async () => {
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Tip 50 pesos')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Tip 50 pesos'));
    fireEvent.press(screen.getByLabelText('Pay tip with Maya'));

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Pay ₱50 tip'));
    });

    expect(mockTipCheckout).toHaveBeenCalledWith('b1', 50, 'maya', { idempotencyKey: 'key-1' });
    expect(mockOpenCheckout).toHaveBeenCalledWith('https://checkout.example/x', 'errandguy://payment-complete');
  });

  it('replays the same key after a timeout, and mints a new one for a changed tip', async () => {
    mockTipCheckout.mockRejectedValueOnce({ status: 0, kind: 'timeout' });
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Tip 50 pesos')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Tip 50 pesos'));

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Pay ₱50 tip'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Pay ₱50 tip'));
    });
    // A different amount is a different charge.
    fireEvent.press(screen.getByLabelText('Tip 20 pesos'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Pay ₱20 tip'));
    });

    const calls = mockTipCheckout.mock.calls.map((c) => ({ amount: c[1], key: c[3].idempotencyKey }));
    expect(calls.map((c) => c.amount)).toEqual([50, 50, 20]);
    expect(calls[0].key).toBe('key-1');
    expect(calls[1].key).toBe('key-1');
    expect(calls[2].key).toBeTruthy();
    expect(calls[2].key).not.toBe('key-1');
  });
});
