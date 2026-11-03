import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ConfirmScreen, { STILL_LOOKING_AFTER_MS } from '../confirm';
import { useBookingStore } from '../../../../stores/bookingStore';
import { bookingService } from '../../../../services/booking.service';
import { useToastStore } from '../../../../stores/toastStore';
import { turnOnPush } from '../../../../services/pushPermission';
import { makeBooking } from '../../../../__mocks__/factories';
import type { Booking, BookingStatus } from '../../../../types';

/**
 * The customer's "waiting for a runner" screen.
 *
 * It used to run its own 60-second countdown and, at zero, declare "No runners
 * available" — while the server was still searching (each direct offer gives
 * one runner 90 seconds to answer). A runner could be holding the offer as the
 * customer was told nobody was free. The rule pinned here: only the server's
 * own `no_runner` status says that; until then the screen keeps looking, and
 * after a while says so calmly.
 */

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({ bookingId: 'bk-1' }),
}));

jest.mock('../../../../services/booking.service', () => ({
  bookingService: {
    getBooking: jest.fn(),
    retryMatch: jest.fn(),
    cancelBooking: jest.fn(),
    cancelPreview: jest.fn(),
  },
}));

// Realtime and the safety-net poll are store writers; the test plays the
// server by writing the store itself.
jest.mock('../../../../hooks/useBookingStatus', () => ({ useBookingStatus: jest.fn() }));
jest.mock('../../../../hooks/useSmartPolling', () => ({ useSmartPolling: jest.fn() }));
jest.mock('../../../../hooks/useBackGuard', () => ({ useBackGuard: jest.fn() }));
// The OS notification permission, as this phone reports it (null = unknown).
let mockPushPermission: 'granted' | 'denied' | 'undetermined' | null = 'granted';
jest.mock('../../../../hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => mockPushPermission,
}));
jest.mock('../../../../services/pushPermission', () => ({ turnOnPush: jest.fn() }));
// jest has no foreground AppState, so the real hook never arms its interval;
// a plain interval is what it does on a device with the screen showing.
jest.mock('../../../../hooks/useForegroundInterval', () => ({
  useForegroundInterval: (cb: () => void, ms: number, enabled = true) => {
    const r: typeof React = require('react');
    const ref = r.useRef(cb);
    ref.current = cb;
    r.useEffect(() => {
      if (!enabled) return;
      const t = setInterval(() => ref.current(), ms);
      return () => clearInterval(t);
    }, [ms, enabled]);
  },
}));

// Visual-only pieces with native/animated internals.
jest.mock('../../../../components/map', () => ({ HereMapView: 'HereMapView', HereMarker: 'HereMarker' }));
jest.mock('../../../../components/customer/RunnerSearchAnimation', () => ({
  RunnerSearchAnimation: () => null,
}));
jest.mock('../../../../components/ui/SuccessCheck', () => ({ SuccessCheck: () => null }));
jest.mock('../../../../components/ui/Illustration', () => ({ Illustration: () => null }));

const booking = (status: BookingStatus, extra: Partial<Booking> = {}): Booking =>
  makeBooking({
    id: 'bk-1',
    booking_number: 'EG-2026-00042',
    status,
    // No pickup coords → the gradient backdrop, not the billed live map.
    pickup_lat: undefined as unknown as number,
    pickup_lng: undefined as unknown as number,
    ...extra,
  });

const serverSays = (status: BookingStatus) =>
  act(() => {
    useBookingStore.setState({ activeBooking: booking(status) });
  });

/** What GET /bookings/{id} answers next (the full BookingResource). */
const serverReads = (...reads: Booking[]) => {
  const mock = bookingService.getBooking as jest.Mock;
  for (const b of reads) mock.mockResolvedValueOnce({ data: { data: b } });
};

/** Let the screen's no_runner re-read land. */
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

/** A prepaid errand nobody took: refunded to the wallet, so no retry. */
const refundedNoRunner = () =>
  booking('no_runner', {
    payment_method: 'gcash',
    can_retry_match: false,
    refunded_amount: '480.00',
    refund_destination: 'wallet',
  });

const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

/** The cancel dialog's confirm — it renders after the screen's own button of the same name. */
const modalConfirm = <T,>(matches: T[]): T => matches[matches.length - 1];

const advance = (ms: number) => {
  // One second per act() so each interval tick's re-render is flushed.
  for (let t = 0; t < ms; t += 1000) {
    act(() => {
      jest.advanceTimersByTime(1000);
    });
  }
};

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
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockPushPermission = 'granted';
  (bookingService.getBooking as jest.Mock).mockReset();
  // Default: the re-read agrees with whatever the store holds (an older
  // server — no can_retry_match — so Search again stays on offer).
  (bookingService.getBooking as jest.Mock).mockImplementation(async () => ({
    data: { data: useBookingStore.getState().activeBooking },
  }));
  useToastStore.setState({ toasts: [] });
  useBookingStore.setState({ activeBooking: booking('pending'), draftBooking: {} });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('waiting for a runner', () => {
  it('never says "No runners available" on its own clock — it keeps looking', () => {
    const { getByText, queryByText } = renderScreen();
    expect(getByText('Looking for a runner nearby…')).toBeTruthy();

    // Well past the old 60s cut-off, and past a full 90s offer window.
    advance(STILL_LOOKING_AFTER_MS + 1000);
    expect(getByText('Still looking…')).toBeTruthy();
    expect(queryByText('No runners available')).toBeNull();

    advance(3 * 60_000);
    expect(getByText('Still looking…')).toBeTruthy();
    expect(queryByText('No runners available')).toBeNull();
    // The customer can still walk away while it searches.
    expect(getByText('Cancel errand')).toBeTruthy();
  });

  it('says "No runners available" the moment the server says no_runner — and offers Search again', async () => {
    const { getByText, queryByText } = renderScreen();

    advance(10_000);
    expect(queryByText('No runners available')).toBeNull();

    serverSays('no_runner');

    expect(getByText('No runners available')).toBeTruthy();
    // It asks the server — skipping the micro-cache — whether a search can
    // still run before offering one; the realtime event can't say.
    expect(bookingService.getBooking).toHaveBeenCalledWith('bk-1', { fresh: true });
    await flush();
    expect(getByText('Search again')).toBeTruthy();
  });

  it('Search again starts a fresh search and judges the server’s answer, not the stale no_runner', async () => {
    (bookingService.retryMatch as jest.Mock).mockResolvedValue({
      data: { data: booking('pending'), meta: { radius_km: 10, widen_step: 1 } },
    });
    const { getByText, queryByText } = renderScreen();

    advance(STILL_LOOKING_AFTER_MS + 1000);
    serverSays('no_runner');
    await flush();

    await act(async () => {
      fireEvent.press(getByText('Search again'));
    });

    expect(bookingService.retryMatch).toHaveBeenCalledWith('bk-1', 1);
    // Back to the opening copy — the "still looking" clock restarted too.
    expect(getByText('Looking for a runner nearby…')).toBeTruthy();
    expect(queryByText('No runners available')).toBeNull();
    expect(useBookingStore.getState().activeBooking?.status).toBe('pending');
  });

  it('shows no_runner straight away when the retried search already came back empty', async () => {
    (bookingService.retryMatch as jest.Mock).mockResolvedValue({
      data: { data: booking('no_runner'), meta: { radius_km: 17.5, widen_step: 1 } },
    });
    const { getByText } = renderScreen();

    serverSays('no_runner');
    await flush();
    await act(async () => {
      fireEvent.press(getByText('Search again'));
    });

    expect(getByText('No runners available')).toBeTruthy();
    // The next retry widens the area rather than repeating the same search.
    expect(getByText('Widen search area')).toBeTruthy();
  });
});

/**
 * A prepaid errand is refunded to the wallet the moment it goes no_runner,
 * so the server will never search it again (it would run for free). The
 * screen used to offer "Search again" anyway — which 409'd every time with
 * the catalog's "You already have an errand" — instead of the only way
 * forward, a new booking.
 */
/**
 * "You can leave, it keeps searching" is only true for someone who will hear
 * "runner found" — with notifications off they never do.
 */
describe('waiting with notifications off', () => {
  it.each(['denied', 'undetermined'] as const)('says so when %s, with the fix one tap away', (state) => {
    mockPushPermission = state;
    const utils = renderScreen();
    expect(
      utils.getByText('Notifications are off. If you leave this screen, we can’t tell you when a runner is found.'),
    ).toBeTruthy();
    fireEvent.press(utils.getByText('Turn on notifications'));
    // The OS prompt while one is left, otherwise the phone's Settings.
    expect(turnOnPush).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when notifications are on, or the phone can’t tell', () => {
    for (const state of ['granted', null] as const) {
      mockPushPermission = state;
      const utils = renderScreen();
      expect(utils.queryByText('Turn on notifications')).toBeNull();
      utils.unmount();
    }
  });
});

describe('when searching again is off the table', () => {
  it('leads with Book again and says where the money went — no Search again', async () => {
    const { getByText, queryByText } = renderScreen();

    // Realtime says no_runner (lifecycle fields only); the fresh read is the
    // verdict.
    serverReads(refundedNoRunner());
    serverSays('no_runner');
    // Never a flash of a Search again that would be refused.
    expect(queryByText('Search again')).toBeNull();
    await flush();

    expect(
      getByText(
        'No runner took this errand, so your ₱480.00 went back to your ErrandGuy wallet. Book it again to find a runner.',
      ),
    ).toBeTruthy();
    expect(getByText('Book again')).toBeTruthy();
    expect(queryByText('Search again')).toBeNull();
    expect(bookingService.retryMatch).not.toHaveBeenCalled();
  });

  it('Book again re-seeds the errand and lands on Review', async () => {
    const { getByText } = renderScreen();
    serverReads(refundedNoRunner());
    serverSays('no_runner');
    await flush();

    fireEvent.press(getByText('Book again'));

    expect(mockReplace).toHaveBeenCalledWith('/(customer)/book/review');
    expect(useBookingStore.getState().draftBooking).toMatchObject({
      errand_type_id: 'errand-type-001',
      pickup_address: '123 Pickup St, Manila',
    });
    expect(useBookingStore.getState().activeBooking).toBeNull();
  });

  it.each([
    ['RETRY_NOT_ALLOWED', 'the new server'],
    ['BOOKING_CONFLICT', 'an older server'],
  ])(
    'a refused Search again (%s, %s) shows the server’s reason and swaps to Book again',
    async (code) => {
      const reason =
        'This booking was already refunded, so it can’t be retried. Please create a new booking to try again.';
      (bookingService.retryMatch as jest.Mock).mockRejectedValue({
        status: 409,
        kind: 'conflict',
        code,
        message: reason,
      });
      const { getByText, queryByText } = renderScreen();
      // A stale read still says a search could run…
      serverReads(booking('no_runner'));
      serverSays('no_runner');
      await flush();

      // …the server, asked for real, says otherwise.
      serverReads(refundedNoRunner());
      await act(async () => {
        fireEvent.press(getByText('Search again'));
      });
      await flush();

      expect(toasts()).toContain(reason);
      expect(toasts().join(' ')).not.toMatch(/already have an errand|in progress/i);
      expect(getByText('Book again')).toBeTruthy();
      expect(queryByText('Search again')).toBeNull();
    },
  );
});

describe('cancelling while it searches', () => {
  it('states the server’s preview — fee and refund — never a hard-coded "no fee"', async () => {
    (bookingService.cancelPreview as jest.Mock).mockResolvedValue({
      data: {
        data: {
          fee: 0,
          tier: 'free',
          reason: 'No fee — runner has not accepted yet.',
          cancellable: true,
          refund_amount: 92,
          refund_destination: 'wallet',
        },
      },
    });
    const { getByText, queryByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Cancel errand'));
    });

    expect(getByText(/Back to your ErrandGuy wallet: ₱92\.00/)).toBeTruthy();
    expect(queryByText(/No fee will be charged/)).toBeNull();
  });

  it('confirms with the server’s receipt, including where the refund went', async () => {
    const receipt =
      'Errand cancelled. ₱92.00 was refunded to your ErrandGuy wallet (new balance ₱92.00).';
    (bookingService.cancelPreview as jest.Mock).mockRejectedValue({ status: 0, kind: 'offline' });
    (bookingService.cancelBooking as jest.Mock).mockResolvedValue({
      data: { data: booking('cancelled'), message: receipt },
    });
    const { getByText, getAllByText, queryByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Cancel errand'));
    });
    // No preview → no promise either way.
    expect(queryByText(/No fee/)).toBeNull();
    await act(async () => {
      fireEvent.press(modalConfirm(getAllByText('Cancel errand')));
    });

    expect(bookingService.cancelBooking).toHaveBeenCalledWith('bk-1', 'Customer cancelled');
    expect(toasts()).toContain(receipt);
    expect(toasts().join(' ')).not.toMatch(/no fee charged/i);
  });

  it('can’t be confirmed until the fee is known', async () => {
    let answer: (v: unknown) => void = () => {};
    (bookingService.cancelPreview as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    (bookingService.cancelBooking as jest.Mock).mockResolvedValue({
      data: { data: booking('cancelled'), message: 'Errand cancelled.' },
    });
    const { getByText, getAllByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Cancel errand'));
    });
    expect(getByText('Checking for a cancellation fee…')).toBeTruthy();
    expect(modalConfirm(getAllByText('Cancel errand'))).toBeDisabled();
    await act(async () => {
      // A disabled press falls through to the dialog card, which swallows it.
      fireEvent.press(modalConfirm(getAllByText('Cancel errand')), { stopPropagation: () => {} });
    });
    expect(bookingService.cancelBooking).not.toHaveBeenCalled();

    await act(async () => {
      answer({
        data: {
          data: {
            fee: 20,
            tier: 'flat',
            reason: 'A small ₱20.00 fee applies — your runner is already on the way.',
            cancellable: true,
          },
        },
      });
    });
    expect(getByText(/Cancellation fee: ₱20\.00/)).toBeTruthy();
    expect(modalConfirm(getAllByText('Cancel errand'))).not.toBeDisabled();
    await act(async () => {
      fireEvent.press(modalConfirm(getAllByText('Cancel errand')));
    });
    expect(bookingService.cancelBooking).toHaveBeenCalledWith('bk-1', 'Customer cancelled');
  });

  it('when the fee check fails, says a fee may apply and offers to check again', async () => {
    (bookingService.cancelPreview as jest.Mock)
      .mockRejectedValueOnce({ status: 0, kind: 'offline' })
      .mockResolvedValueOnce({
        data: {
          data: {
            fee: 0,
            tier: 'free',
            reason: 'No fee — runner has not accepted yet.',
            cancellable: true,
          },
        },
      });
    const { getByText, queryByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Cancel errand'));
    });
    expect(getByText(/If a runner has already accepted your errand, a small fee may apply/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Check the fee again'));
    });
    expect(bookingService.cancelPreview).toHaveBeenCalledTimes(2);
    expect(getByText('No fee — runner has not accepted yet.')).toBeTruthy();
    expect(queryByText('Check the fee again')).toBeNull();
  });
});
