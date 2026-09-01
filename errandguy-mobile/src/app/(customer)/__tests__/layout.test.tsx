import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import CustomerLayout from '../_layout';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore } from '../../../stores/bookingStore';
import { useEchoChannel } from '../../../hooks/useEchoChannel';
import { invalidateQuery } from '../../../hooks/useQuery';
import { bookingService } from '../../../services/booking.service';
import type { Booking, User } from '../../../types';

// The shared expo-router mock exports Stack as a plain object; this group
// layout renders <Stack/> itself, so it needs a real component here.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSegments: () => [],
  Stack: () => null,
}));
jest.mock('../../../hooks/useRealtimeNotifications', () => ({
  useRealtimeNotifications: jest.fn(),
}));
jest.mock('../../../hooks/useEchoChannel', () => ({
  useEchoChannel: jest.fn(() => ({ isConnected: true })),
}));
jest.mock('../../../services/booking.service', () => ({
  bookingService: { getActiveBooking: jest.fn() },
}));
jest.mock('../../../hooks/useQuery', () => {
  const r: typeof React = require('react');
  return {
    useQuery: (
      _key: unknown,
      fetcher: () => Promise<unknown>,
      options: { enabled?: boolean } = {},
    ) => {
      const enabled = options.enabled !== false;
      const [data, setData] = r.useState<unknown>(null);
      r.useEffect(() => {
        if (!enabled) return;
        void (async () => setData(await fetcher()))();
      }, [enabled]);
      return { data, loading: false, error: null, refresh: jest.fn() };
    },
    invalidateQuery: jest.fn(),
  };
});

const mockedEcho = useEchoChannel as jest.Mock;

const booking = (id: string): Booking => ({ id, status: 'accepted' }) as Booking;

/** Every `booking.*` channel the layout subscribed to, in mount order. */
const bookingChannels = () =>
  mockedEcho.mock.calls
    .map((call) => call[0])
    .filter((opts) => opts.channel?.startsWith('booking.') && opts.enabled !== false)
    .map((opts) => opts.channel as string);

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'c1' } as User,
    role: 'customer',
    isAuthenticated: true,
  });
  useBookingStore.setState({ activeBooking: null });
  (bookingService.getActiveBooking as jest.Mock).mockResolvedValue({
    data: { data: null, active_bookings: [] },
  });
});

describe('customer layout — realtime per active errand', () => {
  it('subscribes the second live errand too, not just the store one', async () => {
    useBookingStore.setState({ activeBooking: booking('live') });
    (bookingService.getActiveBooking as jest.Mock).mockResolvedValue({
      data: {
        data: booking('live'),
        active_bookings: [booking('live'), booking('second')],
      },
    });

    render(<CustomerLayout />);

    await waitFor(() => {
      expect(new Set(bookingChannels())).toEqual(
        new Set(['booking.live', 'booking.second']),
      );
    });
  });

  it('never opens a duplicate channel for the store booking', async () => {
    useBookingStore.setState({ activeBooking: booking('live') });
    (bookingService.getActiveBooking as jest.Mock).mockResolvedValue({
      data: { data: booking('live'), active_bookings: [booking('live')] },
    });

    render(<CustomerLayout />);

    await waitFor(() => {
      expect(bookingChannels()).toEqual(['booking.live']);
    });
  });

  it('heals the stack — not the singular store slot — when a secondary moves', async () => {
    useBookingStore.setState({ activeBooking: booking('live') });
    (bookingService.getActiveBooking as jest.Mock).mockResolvedValue({
      data: {
        data: booking('live'),
        active_bookings: [booking('live'), booking('second')],
      },
    });

    render(<CustomerLayout />);

    await waitFor(() => {
      expect(bookingChannels()).toContain('booking.second');
    });

    const secondary = mockedEcho.mock.calls
      .map((c) => c[0])
      .find((o) => o.channel === 'booking.second');
    // A broadcast for the OTHER booking must not be merged into
    // bookingStore.activeBooking — its payload carries its own id.
    secondary.onEvent({ id: 'second', status: 'in_transit' });

    expect(invalidateQuery).toHaveBeenCalledWith(['bookings', 'active-list']);
    expect(useBookingStore.getState().activeBooking?.id).toBe('live');
    expect(useBookingStore.getState().activeBooking?.status).toBe('accepted');
  });

  it('opens nothing when the group is mounted by a runner', async () => {
    useAuthStore.setState({ role: 'runner' });
    render(<CustomerLayout />);
    await waitFor(() => {
      expect(bookingChannels()).toEqual([]);
    });
  });
});
