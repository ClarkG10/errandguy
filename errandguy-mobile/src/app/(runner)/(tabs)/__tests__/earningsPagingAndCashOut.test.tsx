import React from 'react';
import { FlatList, SectionList, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import EarningsScreen from '../earnings';
import HistoryScreen from '../history';
import { runnerService } from '../../../../services/runner.service';
import { userService } from '../../../../services/user.service';
import { useAuthStore } from '../../../../stores/authStore';
import { useRunnerStore } from '../../../../stores/runnerStore';
import type { Booking, User } from '../../../../types';

/**
 * Two things about the runner's paged lists (Earnings and History):
 *
 *  • Earnings' cash-out strip, payout button and Export were the list's
 *    FOOTER. The list loads another page whenever its end is reached, so every
 *    scroll down to them pulled in more rows that pushed them away again.
 *  • Page 1 is refetched behind the runner's back. A shift in its first row
 *    must drop a page 2 still in the air, and a refetch must not re-arm a list
 *    that has already reached its end.
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
    getErrandHistory: jest.fn(),
    getPayoutHistory: jest.fn(),
    getRunnerProfile: jest.fn(),
  },
}));
jest.mock('../../../../services/user.service', () => ({
  userService: { getProfile: jest.fn() },
}));
jest.mock('../../../../services/preload.service', () => ({
  prefetchPayoutActivity: jest.fn(),
  prefetchRunnerErrand: jest.fn(),
}));
jest.mock('../../../../hooks/useHideTabBarOnScroll', () => ({ useHideTabBarOnScroll: () => ({}) }));
jest.mock('../../../../hooks/useDebounce', () => ({ useDebounce: (v: unknown) => v }));
jest.mock('../../../../components/ui/Illustration', () => ({ Illustration: () => null }));

// Runs the fetcher without the AsyncStorage layer, and lets a test refetch one
// query by hand — the "behind the runner's back" refetch.
const mockRefetch: Record<string, () => Promise<void>> = {};
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
      mockRefetch[String(key[2])] = run;
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
const ok = (data: unknown) => ({ data: { data } });

const NOW = Date.parse('2026-09-02T06:00:00Z');
const row = (id: string): Booking =>
  ({
    id,
    status: 'completed',
    booking_number: `EG-${id}`,
    errand_type: { name: 'Delivery' },
    completed_at: '2026-09-02T05:00:00.000000Z',
    created_at: '2026-09-02T05:00:00.000000Z',
    runner_payout: '100.00',
    payment_method_type: 'gcash',
  }) as unknown as Booking;
const rows = (prefix: string, from: number, count: number) =>
  Array.from({ length: count }, (_, i) => row(`${prefix}${from + i}`));

const wrap = (node: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {node}
    </SafeAreaProvider>,
  );

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let nowSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  useAuthStore.setState({ user: { id: 'r1', role: 'runner', wallet_balance: 0 } as unknown as User });
  useRunnerStore.setState({ runnerProfile: null });
  svc.getEarnings.mockResolvedValue(
    ok({ total_earnings: 4500, total_tips: 0, total_errands: 45, avg_per_errand: 100 }),
  );
  svc.getEarningsDaily.mockResolvedValue(ok(null));
  svc.getPayoutHistory.mockResolvedValue(ok([]));
  svc.getRunnerProfile.mockResolvedValue(ok(null));
  (userService.getProfile as jest.Mock).mockResolvedValue(ok(null));
});

afterEach(() => {
  nowSpy.mockRestore();
});

describe('earnings — cash out stays reachable', () => {
  it('puts the cash-out strip, the payout button and Export above the per-errand list', async () => {
    svc.getEarningsHistory.mockResolvedValue(ok(rows('t', 0, 30)));
    const screen = wrap(<EarningsScreen />);
    await waitFor(() => expect(screen.UNSAFE_getByType(SectionList)).toBeTruthy());

    const list = screen.UNSAFE_getByType(SectionList);
    const header = render(<View>{list.props.ListHeaderComponent}</View>);
    expect(header.getByText('Available now')).toBeTruthy();
    expect(header.getByText('Request Payout')).toBeTruthy();
    expect(header.getByText('Export CSV')).toBeTruthy();

    const footer = render(<View>{list.props.ListFooterComponent}</View>);
    expect(footer.queryByText('Request Payout')).toBeNull();
    expect(footer.queryByText('Export CSV')).toBeNull();
  });
});

describe('earnings — page 1 refetched behind the runner’s back', () => {
  const sections = (screen: ReturnType<typeof wrap>) =>
    (screen.UNSAFE_getByType(SectionList).props.sections as Array<{ data: Booking[] }>).flatMap(
      (s) => s.data.map((b) => b.id),
    );

  it('drops a page 2 that was still in the air when page 1’s first row changed', async () => {
    const page2 = deferred<unknown>();
    let page1 = rows('t', 0, 30);
    svc.getEarningsHistory.mockImplementation(({ page }: { page: number }) =>
      page === 1 ? Promise.resolve(ok(page1)) : page2.promise,
    );
    const screen = wrap(<EarningsScreen />);
    await waitFor(() => expect(sections(screen)).toHaveLength(30));

    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(SectionList), 'onEndReached');
    });
    // A new errand finished: everything shifted down by one.
    page1 = [row('new'), ...rows('t', 0, 29)];
    await act(async () => {
      await mockRefetch.list();
    });
    // The page asked for at the OLD offsets lands now.
    await act(async () => {
      page2.resolve(ok(rows('t', 30, 15)));
    });

    expect(sections(screen)).toHaveLength(30);
    expect(sections(screen)[0]).toBe('new');
  });

  it('a refetch of page 1 does not re-arm a list that already reached its end', async () => {
    svc.getEarningsHistory.mockImplementation(async ({ page }: { page: number }) =>
      page === 1 ? ok(rows('t', 0, 30)) : ok(rows('t', 30, 5)),
    );
    const screen = wrap(<EarningsScreen />);
    await waitFor(() => expect(sections(screen)).toHaveLength(30));
    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(SectionList), 'onEndReached');
    });
    await waitFor(() => expect(sections(screen)).toHaveLength(35));

    await act(async () => {
      await mockRefetch.list();
    });
    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(SectionList), 'onEndReached');
    });

    const pages = svc.getEarningsHistory.mock.calls.map((c) => c[0].page);
    expect(pages).not.toContain(3);
  });
});

describe('history — page 1 refetched behind the runner’s back', () => {
  const listed = (screen: ReturnType<typeof wrap>) =>
    (screen.UNSAFE_getByType(FlatList).props.data as Booking[]).map((b) => b.id);

  it('starts the older pages over when page 1’s first row changed', async () => {
    let page1 = rows('h', 0, 15);
    svc.getErrandHistory.mockImplementation(async ({ page }: { page: number }) =>
      page === 1 ? ok(page1) : ok(rows('h', 15, 15)),
    );
    const screen = wrap(<HistoryScreen />);
    await waitFor(() => expect(listed(screen)).toHaveLength(15));
    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(FlatList), 'onEndReached');
    });
    await waitFor(() => expect(listed(screen)).toHaveLength(30));

    // Shifted by one: page 2 at the old offsets would now repeat h14.
    page1 = [row('new'), ...rows('h', 0, 14)];
    await act(async () => {
      await mockRefetch.history();
    });

    const ids = listed(screen);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(15);
  });

  it('drops a page 2 still in the air when page 1 shifted', async () => {
    const page2 = deferred<unknown>();
    let page1 = rows('h', 0, 15);
    svc.getErrandHistory.mockImplementation(({ page }: { page: number }) =>
      page === 1 ? Promise.resolve(ok(page1)) : page2.promise,
    );
    const screen = wrap(<HistoryScreen />);
    await waitFor(() => expect(listed(screen)).toHaveLength(15));
    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(FlatList), 'onEndReached');
    });
    page1 = [row('new'), ...rows('h', 0, 14)];
    await act(async () => {
      await mockRefetch.history();
    });
    await act(async () => {
      page2.resolve(ok(rows('h', 14, 15)));
    });

    const ids = listed(screen);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a refetch of page 1 does not re-arm a list that already reached its end', async () => {
    svc.getErrandHistory.mockImplementation(async ({ page }: { page: number }) =>
      page === 1 ? ok(rows('h', 0, 15)) : ok(rows('h', 15, 3)),
    );
    const screen = wrap(<HistoryScreen />);
    await waitFor(() => expect(listed(screen)).toHaveLength(15));
    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(FlatList), 'onEndReached');
    });
    await waitFor(() => expect(listed(screen)).toHaveLength(18));

    await act(async () => {
      await mockRefetch.history();
    });
    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(FlatList), 'onEndReached');
    });

    const pages = svc.getErrandHistory.mock.calls.map((c) => c[0].page);
    expect(pages).not.toContain(3);
  });
});
