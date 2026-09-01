import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import CustomerHomeScreen from '../index';
import { useAuthStore } from '../../../../stores/authStore';
import { useBookingStore } from '../../../../stores/bookingStore';
import { bookingService } from '../../../../services/booking.service';
import { configService } from '../../../../services/config.service';
import { paymentService } from '../../../../services/payment.service';
import { userService } from '../../../../services/user.service';
import type { Booking, ErrandType, User } from '../../../../types';

jest.mock('../../../../services/booking.service', () => ({
  bookingService: { getBookings: jest.fn(), getActiveBooking: jest.fn() },
}));
jest.mock('../../../../services/config.service', () => ({
  configService: { getErrandTypes: jest.fn(), getPromos: jest.fn() },
}));
jest.mock('../../../../services/payment.service', () => ({
  paymentService: { getWalletBalance: jest.fn() },
}));
jest.mock('../../../../services/user.service', () => ({
  userService: { getReferral: jest.fn() },
}));
jest.mock('../../../../services/preload.service', () => ({
  warmTracking: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../../../hooks/useHideTabBarOnScroll', () => ({
  useHideTabBarOnScroll: () => ({}),
}));

// Same shape as the payout-activity screen test: run the fetcher, skip the
// AsyncStorage layer. `loading` mirrors the real hook (true until the first
// value lands), which the tile-order pin depends on.
jest.mock('../../../../hooks/useQuery', () => {
  const r: typeof React = require('react');
  return {
    useQuery: (
      _key: unknown,
      fetcher: () => Promise<unknown>,
      options: { enabled?: boolean } = {},
    ) => {
      const enabled = options.enabled !== false;
      const [data, setData] = r.useState<unknown>(undefined);
      const run = r.useCallback(async () => {
        if (!enabled) return;
        setData(await fetcher());
      }, [enabled]);
      r.useEffect(() => {
        void run();
      }, [run]);
      return {
        data: data ?? null,
        loading: enabled && data === undefined,
        error: null,
        refresh: run,
        revalidate: run,
        isStale: false,
        updatedAt: null,
        mutate: jest.fn(),
      };
    },
    invalidateQuery: jest.fn(),
  };
});

const type = (id: string, name: string, sort: number): ErrandType =>
  ({ id, slug: id, name, icon_name: 'Package', is_active: true, sort_order: sort }) as ErrandType;

// Abbreviated seeded catalogue — laundry and bills sit past the four tiles.
const CATALOGUE = [
  type('delivery', 'Delivery', 1),
  type('food', 'Food', 2),
  type('grocery', 'Grocery', 3),
  type('pharmacy', 'Pharmacy', 4),
  type('laundry', 'Laundry', 5),
  type('bills', 'Bills Payment', 7),
];

const booking = (id: string, over: Partial<Booking> = {}): Booking =>
  ({
    id,
    status: 'accepted',
    errand_type_id: 'delivery',
    errand_type: { name: 'Delivery' },
    total_amount: 180,
    pickup_address: 'A',
    dropoff_address: 'B',
    created_at: new Date().toISOString(),
    schedule_type: 'now',
    ...over,
  }) as Booking;

const setActive = (list: Booking[]) => {
  (bookingService.getActiveBooking as jest.Mock).mockResolvedValue({
    data: { data: list[0] ?? null, active_bookings: list },
  });
};

const renderHome = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <CustomerHomeScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'c1', full_name: 'Rina Cruz' } as User,
    role: 'customer',
    isAuthenticated: true,
  });
  useBookingStore.setState({ activeBooking: null, draftBooking: {}, currentStep: 0 });
  (configService.getErrandTypes as jest.Mock).mockResolvedValue({
    data: { data: CATALOGUE },
  });
  (configService.getPromos as jest.Mock).mockResolvedValue({ data: { data: [] } });
  (paymentService.getWalletBalance as jest.Mock).mockResolvedValue({
    data: { data: { balance: 0 } },
  });
  (userService.getReferral as jest.Mock).mockResolvedValue({ data: { data: null } });
  (bookingService.getBookings as jest.Mock).mockResolvedValue({ data: { data: [] } });
  setActive([]);
});

describe('customer home — the live-errand stack', () => {
  it('renders one card, and no pager, for a single active errand', async () => {
    setActive([booking('one')]);
    const { queryAllByLabelText, queryByTestId, getByText } = renderHome();

    await waitFor(() => {
      expect(queryAllByLabelText(/^Active errand:/)).toHaveLength(1);
    });
    expect(getByText('Your errand')).toBeTruthy();
    // A lone errand keeps the full-width card — no carousel, no dots.
    expect(queryByTestId('active-errand-pager')).toBeNull();
  });

  it('stacks a card per active errand instead of hiding all but the newest', async () => {
    setActive([
      booking('live', { status: 'in_transit' }),
      booking('second', { status: 'pending', errand_type: { name: 'Laundry' } as never }),
    ]);
    const { queryAllByLabelText, queryByTestId, getByText } = renderHome();

    await waitFor(() => {
      expect(queryAllByLabelText(/^Active errand:/)).toHaveLength(2);
    });
    expect(queryByTestId('active-errand-pager')).not.toBeNull();
    // The count is the only spoken cue for the stack's size (the dots are
    // hidden from the accessibility tree).
    expect(getByText('Your errands · 2 active')).toBeTruthy();
  });

  it('caps the stack at three even when the API sends more', async () => {
    setActive(['a', 'b', 'c', 'd'].map((id) => booking(id)));
    const { queryAllByLabelText } = renderHome();

    await waitFor(() => {
      expect(queryAllByLabelText(/^Active errand:/)).toHaveLength(3);
    });
  });

  it('gives a future scheduled errand its own calm card inside the stack', async () => {
    const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    setActive([
      booking('live', { status: 'in_transit' }),
      booking('later', {
        status: 'pending',
        schedule_type: 'scheduled',
        scheduled_at: tomorrow,
      }),
    ]);
    const { queryAllByLabelText } = renderHome();

    await waitFor(() => {
      expect(queryAllByLabelText(/^Active errand:/)).toHaveLength(1);
    });
    expect(queryAllByLabelText(/^Scheduled errand:/)).toHaveLength(1);
  });

  it('falls back to the singular row when the API has no active_bookings key', async () => {
    (bookingService.getActiveBooking as jest.Mock).mockResolvedValue({
      data: { data: booking('only') },
    });
    const { queryAllByLabelText } = renderHome();

    await waitFor(() => {
      expect(queryAllByLabelText(/^Active errand:/)).toHaveLength(1);
    });
  });
});

describe('customer home — service tiles', () => {
  // Rendered order, not catalogue order — the whole point of the change.
  const tileNames = (utils: ReturnType<typeof renderHome>) =>
    utils
      .queryAllByLabelText(/^Start a .+ errand$/)
      .map((node) =>
        String(node.props.accessibilityLabel)
          .replace(/^Start a /, '')
          .replace(/ errand$/, ''),
      );

  it('keeps the catalogue order for a customer with no history', async () => {
    const utils = renderHome();
    await waitFor(() => {
      expect(utils.queryByLabelText('Start a Delivery errand')).toBeTruthy();
    });
    expect(tileNames(utils)).toEqual(['Delivery', 'Food', 'Grocery', 'Pharmacy']);
  });

  it('lifts the services this customer actually books onto the tiles', async () => {
    (bookingService.getBookings as jest.Mock).mockResolvedValue({
      data: {
        data: [
          booking('1', { errand_type_id: 'bills' }),
          booking('2', { errand_type_id: 'bills' }),
          booking('3', { errand_type_id: 'laundry' }),
          booking('4', { errand_type_id: 'laundry' }),
          // A single booking is not a habit — grocery must not be promoted.
          booking('5', { errand_type_id: 'grocery' }),
        ],
      },
    });
    const utils = renderHome();

    await waitFor(() => {
      expect(utils.queryByLabelText('Start a Bills Payment errand')).toBeTruthy();
    });
    // bills and laundry tie at 2, so sort_order breaks it: laundry (5) first.
    expect(tileNames(utils)).toEqual([
      'Laundry',
      'Bills Payment',
      'Delivery',
      'Food',
    ]);
  });
});
