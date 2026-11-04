import React from 'react';
import { SectionList, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import EarningsScreen from '../earnings';
import { runnerService } from '../../../../services/runner.service';
import { userService } from '../../../../services/user.service';
import { useAuthStore } from '../../../../stores/authStore';
import { useRunnerStore } from '../../../../stores/runnerStore';
import type { Booking, User } from '../../../../types';

/**
 * The Earnings tab used to fetch ONE page of up to 100 errands and add up its
 * day groups and week chart from it, so a busy month dropped its oldest days
 * and showed the runner smaller numbers than they earned. The day totals come
 * from GET /runner/earnings/daily now, and the list pages in as you scroll.
 */

jest.mock('expo-router', () => {
  const r: typeof React = require('react');
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      r.useEffect(() => cb(), [cb]);
    },
  };
});
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn(),
  downloadAsync: jest.fn(),
  EncodingType: { UTF8: 'utf8' },
}));
jest.mock('../../../../services/runner.service', () => ({
  runnerService: {
    getEarnings: jest.fn(),
    getEarningsDaily: jest.fn(),
    getEarningsHistory: jest.fn(),
    getPayoutHistory: jest.fn(),
    getRunnerProfile: jest.fn(),
  },
}));
jest.mock('../../../../services/user.service', () => ({
  userService: { getProfile: jest.fn() },
}));
jest.mock('../../../../services/preload.service', () => ({ prefetchPayoutActivity: jest.fn() }));
jest.mock('../../../../hooks/useHideTabBarOnScroll', () => ({ useHideTabBarOnScroll: () => ({}) }));
jest.mock('../../../../components/ui/Illustration', () => ({ Illustration: () => null }));

// Runs the fetcher and reports its failure, without the AsyncStorage layer.
jest.mock('../../../../hooks/useQuery', () => {
  const r: typeof React = require('react');
  return {
    useQuery: (key: unknown[], fetcher: () => Promise<unknown>) => {
      const [data, setData] = r.useState<unknown>(undefined);
      const [error, setError] = r.useState<unknown>(null);
      const k = JSON.stringify(key);
      const run = r.useCallback(async () => {
        try {
          setData(await fetcher());
          setError(null);
        } catch (e) {
          setError(e);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [k]);
      r.useEffect(() => {
        void run();
      }, [run]);
      return {
        data: data === undefined ? null : data,
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

const svc = runnerService as unknown as Record<string, jest.Mock>;

// Wed 2 Sep 2026, 14:00 in Manila.
const NOW = Date.parse('2026-09-02T06:00:00Z');

const row = (id: string, completedAtUtc: string, payout: number): Booking =>
  ({
    id,
    status: 'completed',
    errand_type: { name: 'Delivery' },
    completed_at: completedAtUtc,
    created_at: completedAtUtc,
    runner_payout: payout.toFixed(2),
    payment_method_type: 'gcash',
  }) as unknown as Booking;

/** Today's errands, 13:00 Manila, ₱100 each. */
const todayRows = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => row(`t${from + i}`, '2026-09-02T05:00:00.000000Z', 100));

const DAILY = {
  timezone: 'Asia/Manila',
  utc_offset_minutes: 480,
  days: [
    { date: '2026-09-02', errands: 45, earnings: 4500, tips: 0, cash_earnings: 1500 },
    { date: '2026-09-01', errands: 10, earnings: 1000, tips: 0, cash_earnings: 0 },
    { date: '2026-08-31', errands: 5, earnings: 600, tips: 0, cash_earnings: 600 },
  ],
};
const SUMMARY = { total_earnings: 6100, total_tips: 0, total_errands: 60, avg_per_errand: 101.67 };

const ok = (data: unknown) => ({ data: { data } });

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <EarningsScreen />
    </SafeAreaProvider>,
  );

/** The day sections the list is rendering: [label, header total, rows loaded]. */
const days = (screen: ReturnType<typeof renderScreen>) =>
  (screen.UNSAFE_getByType(SectionList).props.sections as Array<{
    label: string;
    total: number;
    data: unknown[];
  }>).map((s) => [s.label, s.total, s.data.length]);

const listed = async (screen: ReturnType<typeof renderScreen>) =>
  waitFor(() => expect(days(screen).length).toBeGreaterThan(0));

const scrollToEnd = async (screen: ReturnType<typeof renderScreen>) => {
  await act(async () => {
    fireEvent(screen.UNSAFE_getByType(SectionList), 'onEndReached');
  });
};

let nowSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  useAuthStore.setState({ user: { id: 'r1', role: 'runner', wallet_balance: 0 } as unknown as User });
  useRunnerStore.setState({ runnerProfile: null });
  svc.getEarnings.mockResolvedValue(ok(SUMMARY));
  svc.getEarningsDaily.mockResolvedValue(ok(DAILY));
  svc.getPayoutHistory.mockResolvedValue(ok([]));
  svc.getRunnerProfile.mockResolvedValue(ok(null));
  (userService.getProfile as jest.Mock).mockResolvedValue(ok(null));
  svc.getEarningsHistory.mockImplementation(async ({ page }: { page: number }) =>
    page === 1 ? ok(todayRows(0, 30)) : ok(todayRows(30, 15)),
  );
});

afterEach(() => {
  nowSpy.mockRestore();
});

describe('earnings — day totals from the server', () => {
  it('heads today with the whole day’s ₱4,500, though only 30 of its 45 errands are loaded', async () => {
    const screen = renderScreen();

    await listed(screen);
    expect(days(screen)).toEqual([['Today', 4500, 30]]);
    expect(screen.getByText('₱4,500.00')).toBeTruthy();
    // Not the ₱3,000 that the loaded rows add up to.
    expect(screen.queryByText('₱3,000.00')).toBeNull();
    expect(svc.getEarningsDaily).toHaveBeenCalledWith('week');
    expect(svc.getEarningsHistory).toHaveBeenCalledWith({ page: 1, per_page: 30, period: 'week' });
  });

  it('draws every day of the week from the server totals', async () => {
    const screen = renderScreen();

    await waitFor(() => expect(screen.getByLabelText('Monday: ₱600.00')).toBeTruthy());
    expect(screen.getByLabelText('Tuesday: ₱1,000.00')).toBeTruthy();
    expect(screen.getByLabelText('Wednesday, today: ₱4,500.00, best day')).toBeTruthy();
    expect(screen.getByLabelText('Thursday: ₱0.00')).toBeTruthy();
  });

  it('keeps the cash / online split though most errands are not loaded', async () => {
    const screen = renderScreen();

    await waitFor(() => expect(screen.getByText(/cash already in hand/)).toBeTruthy());
    expect(screen.getByText('₱2,100.00')).toBeTruthy();
    expect(screen.getByText('₱4,000.00')).toBeTruthy();
  });

  it('on a server without the endpoint, adds up the loaded rows as before', async () => {
    svc.getEarningsDaily.mockRejectedValue({ status: 404, kind: 'not_found', message: 'Not found' });
    const screen = renderScreen();

    await listed(screen);
    expect(days(screen)).toEqual([['Today', 3000, 30]]);
    expect(screen.getByText('₱3,000.00')).toBeTruthy();
  });
});

describe('earnings — the list pages in', () => {
  it('loads the next page of the same period on scroll and lists it under the same day', async () => {
    const screen = renderScreen();
    await listed(screen);

    await scrollToEnd(screen);

    expect(svc.getEarningsHistory).toHaveBeenLastCalledWith({ page: 2, per_page: 30, period: 'week' });
    // Still one "Today", now with all 45 rows, still the server's total.
    await waitFor(() => expect(days(screen)).toEqual([['Today', 4500, 45]]));
  });

  it('offers Try again when a page fails, and only retries on the tap', async () => {
    svc.getEarningsHistory.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 1) return ok(todayRows(0, 30));
      throw { status: 0, kind: 'offline', message: 'Network error.' };
    });
    const screen = renderScreen();
    await listed(screen);

    await scrollToEnd(screen);
    await waitFor(() => expect(screen.getByText('Couldn’t load more · Try again')).toBeTruthy());

    // Scrolling again doesn't re-fire the failing request.
    await scrollToEnd(screen);
    expect(svc.getEarningsHistory).toHaveBeenCalledTimes(2);

    svc.getEarningsHistory.mockResolvedValue(ok(todayRows(30, 15)));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Retry loading more errands'));
    });
    expect(svc.getEarningsHistory).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(screen.queryByText('Couldn’t load more · Try again')).toBeNull());
  });

  it('stops asking once a short page says there is no more', async () => {
    svc.getEarningsHistory.mockImplementation(async ({ page }: { page: number }) =>
      page === 1 ? ok(todayRows(0, 12)) : ok([]),
    );
    const screen = renderScreen();
    await listed(screen);

    await scrollToEnd(screen);
    expect(svc.getEarningsHistory).toHaveBeenCalledTimes(1);
  });
});

describe('earnings — CSV export', () => {
  it('covers the whole period, not just the rows scrolled into view', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const screen = renderScreen();
    await listed(screen);

    // Page 1 holds 30 of the 45; the export fetches the period in full pages.
    svc.getEarningsHistory.mockImplementation(async ({ page, per_page }: { page: number; per_page: number }) =>
      per_page === 100 && page === 1 ? ok(todayRows(0, 45)) : ok([]),
    );
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Export CSV'));
    });

    await waitFor(() => expect(FileSystem.writeAsStringAsync).toHaveBeenCalled());
    expect(svc.getEarningsHistory).toHaveBeenCalledWith({ page: 1, per_page: 100, period: 'week' });
    const csv = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][1] as string;
    expect(csv.split('\n')).toHaveLength(1 + 45);
  });
});
