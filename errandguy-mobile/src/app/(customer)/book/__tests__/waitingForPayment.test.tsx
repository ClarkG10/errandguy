import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ConfirmScreen from '../confirm';
import { useBookingStore } from '../../../../stores/bookingStore';
import { usePaymentStore } from '../../../../stores/paymentStore';
import { openCheckoutUrl, PAYMENT_RETURN_URL } from '../../../../utils/browser';
import { CHECKOUT_CANCELLED_MESSAGE } from '../../../../hooks/useCompleteBookingPayment';
import { makeBooking } from '../../../../__mocks__/factories';
import type { Booking, BookingStatus } from '../../../../types';

/**
 * The waiting screen for a GCash/Maya booking.
 *
 * The server no longer offers such a booking to any runner until its payment
 * is confirmed, and cancels it if it's still unpaid 15 minutes later. So the
 * screen must say "Waiting for your payment" with a real way to pay — never
 * "Looking for a runner" — hand over to the ordinary search the moment the
 * payment lands, and say plainly when the errand was cancelled for being
 * unpaid, with "Book again".
 */

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({ bookingId: 'bk-1' }),
}));

jest.mock('../../../../services/booking.service', () => ({
  bookingService: {
    getBooking: jest.fn(() => new Promise(() => {})),
    retryMatch: jest.fn(),
    cancelBooking: jest.fn(),
  },
}));

jest.mock('../../../../utils/browser', () => ({
  PAYMENT_RETURN_URL: 'errandguy://payment-complete',
  openCheckoutUrl: jest.fn(),
}));

// Realtime and the polls are store writers; the test plays the server by
// writing the store itself.
jest.mock('../../../../hooks/useBookingStatus', () => ({ useBookingStatus: jest.fn() }));
jest.mock('../../../../hooks/useSmartPolling', () => ({ useSmartPolling: jest.fn() }));
jest.mock('../../../../hooks/useBackGuard', () => ({ useBackGuard: jest.fn() }));
jest.mock('../../../../hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => 'granted',
}));
jest.mock('../../../../hooks/useForegroundInterval', () => ({ useForegroundInterval: jest.fn() }));

// Visual-only pieces with native/animated internals.
jest.mock('../../../../components/map', () => ({ HereMapView: 'HereMapView', HereMarker: 'HereMarker' }));
jest.mock('../../../../components/customer/RunnerSearchAnimation', () => ({
  RunnerSearchAnimation: () => null,
}));
jest.mock('../../../../components/ui/SuccessCheck', () => ({ SuccessCheck: () => null }));
jest.mock('../../../../components/ui/Illustration', () => ({ Illustration: () => null }));

const CHECKOUT = 'https://checkout.example/pay/abc';

const booking = (status: BookingStatus, extra: Partial<Booking> = {}): Booking =>
  makeBooking({
    id: 'bk-1',
    booking_number: 'EG-2026-00042',
    status,
    total_amount: 92,
    // No pickup coords → the gradient backdrop, not the billed live map.
    pickup_lat: undefined as unknown as number,
    pickup_lng: undefined as unknown as number,
    ...extra,
  });

const unpaid = (extra: Partial<Booking> = {}) =>
  booking('pending', { awaiting_payment: true, checkout_url: CHECKOUT, ...extra });

const serverSays = (b: Booking) =>
  act(() => {
    useBookingStore.setState({ activeBooking: b });
  });

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ConfirmScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  usePaymentStore.setState({ attempt: null, isHydrated: true });
  useBookingStore.setState({ activeBooking: unpaid(), draftBooking: {} });
});

describe('waiting for a GCash/Maya payment', () => {
  it('says it is waiting for the payment — not looking for a runner', () => {
    const { getByText, queryByText } = renderScreen();
    expect(getByText('Waiting for your payment')).toBeTruthy();
    expect(getByText('Complete payment')).toBeTruthy();
    expect(queryByText('Looking for a runner nearby…')).toBeNull();
    // The customer can still walk away instead of paying.
    expect(getByText('Cancel errand')).toBeTruthy();
  });

  it("Complete payment reopens the booking's own checkout in the return-aware sheet", async () => {
    (openCheckoutUrl as jest.Mock).mockResolvedValue('opened');
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Complete payment'));
    });

    expect(openCheckoutUrl).toHaveBeenCalledWith(CHECKOUT, PAYMENT_RETURN_URL);
    // Verified, never assumed: a booking attempt for THIS booking is now being
    // checked by the shared payment verifier.
    const attempt = usePaymentStore.getState().attempt;
    expect(attempt).toMatchObject({
      kind: 'booking',
      bookingId: 'bk-1',
      checkoutUrl: CHECKOUT,
      status: 'verifying',
    });
  });

  it('a backed-out checkout lands on "Resume payment", with the real way back', async () => {
    (openCheckoutUrl as jest.Mock).mockResolvedValue('cancelled');
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Complete payment'));
    });

    expect(getByText('Resume payment')).toBeTruthy();
    expect(getByText(CHECKOUT_CANCELLED_MESSAGE)).toBeTruthy();
    expect(CHECKOUT_CANCELLED_MESSAGE).toMatch(/Complete payment/);
    // The old copy promised paying later "from the errand" — a button that
    // didn't exist.
    expect(CHECKOUT_CANCELLED_MESSAGE).not.toMatch(/from the errand/i);
  });

  it('never opens a second payment over one still being confirmed', async () => {
    usePaymentStore.getState().beginAttempt({ kind: 'tip', amount: 50, transactionId: 'tx-1' });
    usePaymentStore.getState().setStatus('verifying');
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Complete payment'));
    });

    expect(openCheckoutUrl).not.toHaveBeenCalled();
  });

  it('hides Complete payment when the server sent no checkout link', () => {
    useBookingStore.setState({ activeBooking: unpaid({ checkout_url: null }) });
    const { getByText, queryByText } = renderScreen();
    expect(getByText('Waiting for your payment')).toBeTruthy();
    expect(queryByText('Complete payment')).toBeNull();
  });

  it('hands over to the ordinary search the moment the payment is confirmed', () => {
    const { getByText, queryByText } = renderScreen();
    expect(getByText('Waiting for your payment')).toBeTruthy();

    serverSays(booking('pending', { awaiting_payment: false, checkout_url: null }));

    expect(getByText('Looking for a runner nearby…')).toBeTruthy();
    expect(queryByText('Waiting for your payment')).toBeNull();
    expect(queryByText('Complete payment')).toBeNull();
  });

  it('keeps the old flow against a server that sends no awaiting_payment', () => {
    useBookingStore.setState({ activeBooking: booking('pending') });
    const { getByText, queryByText } = renderScreen();
    expect(getByText('Looking for a runner nearby…')).toBeTruthy();
    expect(queryByText('Waiting for your payment')).toBeNull();
  });
});

describe('cancelled because the payment was never completed', () => {
  const cancelledUnpaid = () =>
    booking('cancelled', {
      awaiting_payment: false,
      checkout_url: null,
      cancellation_reason: "Payment wasn't completed, so your errand was cancelled.",
      cancelled_at: '2026-10-31T06:15:00.000Z',
    });

  it('says so plainly and offers Book again', () => {
    const { getByText, queryByText } = renderScreen();
    serverSays(cancelledUnpaid());

    expect(getByText('Payment not completed')).toBeTruthy();
    expect(
      getByText(
        "Your payment wasn't completed, so this errand was cancelled before any runner was sent. You weren't charged.",
      ),
    ).toBeTruthy();
    expect(getByText('Book again')).toBeTruthy();
    // Not the generic card.
    expect(queryByText('Errand cancelled')).toBeNull();
  });

  it('Book again re-seeds the errand and lands on Review', () => {
    const { getByText } = renderScreen();
    serverSays(cancelledUnpaid());

    fireEvent.press(getByText('Book again'));

    expect(mockReplace).toHaveBeenCalledWith('/(customer)/book/review');
    expect(useBookingStore.getState().draftBooking).toMatchObject({
      errand_type_id: 'errand-type-001',
      pickup_address: '123 Pickup St, Manila',
    });
  });

  it('keeps the generic card for any other cancellation', () => {
    const { getByText, queryByText } = renderScreen();
    serverSays(booking('cancelled', { cancellation_reason: 'Cancelled by support' }));

    expect(getByText('Errand cancelled')).toBeTruthy();
    expect(queryByText('Payment not completed')).toBeNull();
  });
});

/**
 * The verdict on a reopened checkout. "Try again" reopens the SAME one-time
 * charge, which only makes sense while it is still open: once the server has
 * ruled — declined, expired, or paid too late and refunded — it has cancelled
 * the errand and that checkout can never succeed. The overlay used to offer
 * "Try again" (and say "You weren't charged") for all of them.
 */
describe('the payment verdict after Complete payment', () => {
  const openAndVerify = async (screen: ReturnType<typeof renderScreen>) => {
    (openCheckoutUrl as jest.Mock).mockResolvedValue('opened');
    await act(async () => {
      fireEvent.press(screen.getByText('Complete payment'));
    });
    expect(usePaymentStore.getState().attempt?.status).toBe('verifying');
  };

  /** The shared verifier's ruling (its poll is mocked out here). */
  const verifierRules = (failureReason: string) =>
    act(() => {
      usePaymentStore.getState().setStatus('failed', { failureReason });
    });

  it.each([
    ['DECLINED_BY_PROVIDER', 'Payment declined'],
    ['expired', 'Payment expired'],
  ])('a %s charge offers Book again — never Try again', async (reason, title) => {
    const screen = renderScreen();
    await openAndVerify(screen);

    verifierRules(reason);

    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(/so this errand was cancelled\. You weren't charged/)).toBeTruthy();
    expect(screen.getByText('Book again')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText('Resume payment')).toBeNull();
  });

  it('a refunded payment says it went back to the wallet, with no Try again', async () => {
    const screen = renderScreen();
    await openAndVerify(screen);

    verifierRules('refunded');

    expect(screen.getByText('Payment refunded')).toBeTruthy();
    expect(
      screen.getByText(
        'Your payment went through after the errand was cancelled, so it was returned to your ErrandGuy wallet.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText(/weren't charged/)).toBeNull();
  });

  it('Book again from the overlay re-seeds the errand and releases the payment lock', async () => {
    const screen = renderScreen();
    await openAndVerify(screen);
    verifierRules('DECLINED_BY_PROVIDER');

    fireEvent.press(screen.getByText('Book again'));

    expect(usePaymentStore.getState().attempt).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/(customer)/book/review');
    expect(useBookingStore.getState().draftBooking).toMatchObject({
      errand_type_id: 'errand-type-001',
      pickup_address: '123 Pickup St, Manila',
    });
  });

  it('stays up when the re-read shows the errand cancelled underneath it', async () => {
    const screen = renderScreen();
    await openAndVerify(screen);
    verifierRules('DECLINED_BY_PROVIDER');

    // The server cancels the unpaid errand; the screen's re-read lands.
    serverSays(
      booking('cancelled', {
        awaiting_payment: false,
        checkout_url: null,
        cancellation_code: 'payment_not_completed',
      }),
    );

    expect(screen.getByText('Payment declined')).toBeTruthy();
    expect(screen.getAllByText('Book again').length).toBeGreaterThan(0);
  });
});
