import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ConfirmScreen, { STILL_LOOKING_AFTER_MS } from '../confirm';
import { useBookingStore } from '../../../../stores/bookingStore';
import { bookingService } from '../../../../services/booking.service';
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ bookingId: 'bk-1' }),
}));

jest.mock('../../../../services/booking.service', () => ({
  bookingService: {
    getBooking: jest.fn(),
    retryMatch: jest.fn(),
    cancelBooking: jest.fn(),
  },
}));

// Realtime and the safety-net poll are store writers; the test plays the
// server by writing the store itself.
jest.mock('../../../../hooks/useBookingStatus', () => ({ useBookingStatus: jest.fn() }));
jest.mock('../../../../hooks/useSmartPolling', () => ({ useSmartPolling: jest.fn() }));
jest.mock('../../../../hooks/useBackGuard', () => ({ useBackGuard: jest.fn() }));
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

const booking = (status: BookingStatus): Booking =>
  makeBooking({
    id: 'bk-1',
    booking_number: 'EG-2026-00042',
    status,
    // No pickup coords → the gradient backdrop, not the billed live map.
    pickup_lat: undefined as unknown as number,
    pickup_lng: undefined as unknown as number,
  });

const serverSays = (status: BookingStatus) =>
  act(() => {
    useBookingStore.setState({ activeBooking: booking(status) });
  });

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
    expect(getByText('Cancel Booking')).toBeTruthy();
  });

  it('says "No runners available" the moment the server says no_runner — and offers Search again', () => {
    const { getByText, queryByText } = renderScreen();

    advance(10_000);
    expect(queryByText('No runners available')).toBeNull();

    serverSays('no_runner');

    expect(getByText('No runners available')).toBeTruthy();
    expect(getByText('Search again')).toBeTruthy();
  });

  it('Search again starts a fresh search and judges the server’s answer, not the stale no_runner', async () => {
    (bookingService.retryMatch as jest.Mock).mockResolvedValue({
      data: { data: booking('pending'), meta: { radius_km: 10, widen_step: 1 } },
    });
    const { getByText, queryByText } = renderScreen();

    advance(STILL_LOOKING_AFTER_MS + 1000);
    serverSays('no_runner');

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
    await act(async () => {
      fireEvent.press(getByText('Search again'));
    });

    expect(getByText('No runners available')).toBeTruthy();
    // The next retry widens the area rather than repeating the same search.
    expect(getByText('Widen search area')).toBeTruthy();
  });
});
