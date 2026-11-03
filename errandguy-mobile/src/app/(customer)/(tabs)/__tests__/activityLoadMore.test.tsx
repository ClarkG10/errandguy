import React from 'react';
import { SectionList } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ActivityScreen from '../activity';
import { bookingService } from '../../../../services/booking.service';
import { useAuthStore } from '../../../../stores/authStore';
import { useToastStore } from '../../../../stores/toastStore';
import type { Booking, User } from '../../../../types';

/**
 * Activity pages the whole history and filters it on the phone. When the next
 * page failed, the auto-pager (which fills a filter whose matches aren't on
 * page 1) refired the moment the request settled: offline it looped, stacked
 * an error toast per attempt and left the tab on a skeleton for good. A failed
 * page now waits for an explicit "Try again", like the wallet and the runner's
 * history.
 */

jest.mock('../../../../services/booking.service', () => ({
  bookingService: { getBookings: jest.fn() },
}));
jest.mock('../../../../hooks/useHideTabBarOnScroll', () => ({
  useHideTabBarOnScroll: () => ({}),
}));
jest.mock('../../../../components/ui/Illustration', () => ({ Illustration: () => null }));
jest.mock('../../../../components/customer/BookingDetailSheet', () => ({
  BookingDetailSheet: () => null,
}));
jest.mock('../../../../components/customer/RecentErrandItem', () => ({
  RecentErrandItem: ({ booking }: { booking: { id: string } }) => {
    const { Text: RNText } = require('react-native');
    return <RNText>{`row ${booking.id}`}</RNText>;
  },
}));

// Runs the fetcher and reports its failure, without the AsyncStorage layer.
jest.mock('../../../../hooks/useQuery', () => {
  const r: typeof React = require('react');
  return {
    useQuery: (_key: unknown, fetcher: () => Promise<unknown>) => {
      const [data, setData] = r.useState<unknown>(undefined);
      const [error, setError] = r.useState<unknown>(null);
      const run = r.useCallback(async () => {
        try {
          setData(await fetcher());
          setError(null);
        } catch (e) {
          setError(e);
        }
      }, []);
      r.useEffect(() => {
        void run();
      }, [run]);
      return {
        data: data ?? null,
        loading: data === undefined && error == null,
        error,
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

const getBookings = bookingService.getBookings as jest.Mock;

const booking = (id: string, status: Booking['status']): Booking =>
  ({
    id,
    status,
    booking_number: `EG-${id}`,
    errand_type: { name: 'Delivery' },
    total_amount: 180,
    created_at: new Date().toISOString(),
    schedule_type: 'now',
  }) as unknown as Booking;

const page = (prefix: string, status: Booking['status'], count = 20) =>
  Array.from({ length: count }, (_, i) => booking(`${prefix}${i}`, status));

const ok = (list: Booking[]) => ({ data: { data: list } });
const OFFLINE = { status: 0, kind: 'offline', message: 'Network error.' };

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ActivityScreen />
    </SafeAreaProvider>,
  );

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const errorToasts = () =>
  useToastStore.getState().toasts.filter((t) => t.variant === 'error');

beforeEach(() => {
  jest.clearAllMocks();
  getBookings.mockReset();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ user: { id: 'c1', full_name: 'Rina Cruz' } as User, isAuthenticated: true });
});

describe('Activity — loading older errands', () => {
  it('a filter whose errands are further back stops after one failed page and offers Try again', async () => {
    getBookings
      .mockResolvedValueOnce(ok(page('a', 'accepted'))) // page 1: nothing completed
      .mockRejectedValueOnce(OFFLINE); // page 2 fails
    const screen = renderScreen();
    await flush();

    await act(async () => {
      fireEvent.press(screen.getByText('Completed'));
    });
    await flush();
    await flush();

    // Page 1 + ONE try at page 2 — not a retry loop.
    expect(getBookings).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Couldn’t load more of your errands')).toBeTruthy();
    // Says why (offline), and no toast per attempt.
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();
    expect(errorToasts()).toHaveLength(0);

    getBookings.mockResolvedValueOnce(ok([booking('done1', 'completed')]));
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });
    await flush();

    expect(getBookings).toHaveBeenCalledTimes(3);
    expect(getBookings).toHaveBeenLastCalledWith({ page: 2, per_page: 20 });
    expect(screen.getByText('row done1')).toBeTruthy();
  });

  it('a failed page under a full list shows an inline retry, and scrolling doesn’t refire it', async () => {
    getBookings.mockResolvedValueOnce(ok(page('a', 'completed'))).mockRejectedValueOnce(OFFLINE);
    const screen = renderScreen();
    await flush();

    const list = screen.UNSAFE_getByType(SectionList);
    await act(async () => {
      list.props.onEndReached();
    });
    await flush();
    expect(getBookings).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Retry loading more errands')).toBeTruthy();

    await act(async () => {
      screen.UNSAFE_getByType(SectionList).props.onEndReached();
    });
    await flush();
    expect(getBookings).toHaveBeenCalledTimes(2);
    expect(errorToasts()).toHaveLength(0);

    getBookings.mockResolvedValueOnce(ok([booking('older1', 'completed')]));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Retry loading more errands'));
    });
    await flush();
    expect(getBookings).toHaveBeenCalledTimes(3);
    // (Below the rendered window, so checked in the list's data.)
    const ids = (screen.UNSAFE_getByType(SectionList).props.sections as { data: Booking[] }[])
      .flatMap((sec) => sec.data.map((b) => b.id));
    expect(ids).toContain('older1');
    expect(screen.queryByLabelText('Retry loading more errands')).toBeNull();
  });

  it('never pages past a first page that failed to load', async () => {
    getBookings.mockRejectedValueOnce(OFFLINE);
    const screen = renderScreen();
    await flush();

    await act(async () => {
      fireEvent.press(screen.getByText('Completed'));
    });
    await flush();

    expect(getBookings).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Couldn't load your errands")).toBeTruthy();
  });
});
