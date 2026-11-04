import React from 'react';
import { FlatList } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RunnerHistoryScreen from '../(tabs)/history';
import { runnerService } from '../../../services/runner.service';
import type { Booking } from '../../../types';

/**
 * Page 2 of a history search must be fetched with the CURRENT term. The
 * next-page callback didn't list the search term among its dependencies, so
 * after typing a new search, scrolling down loaded the old term's (or the
 * unfiltered) rows into the results.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('../../../services/runner.service', () => ({
  runnerService: { getErrandHistory: jest.fn() },
}));
jest.mock('../../../services/preload.service', () => ({ prefetchRunnerErrand: jest.fn() }));
jest.mock('../../../components/ui/Illustration', () => ({ Illustration: () => null }));
jest.mock('../../../hooks/useHideTabBarOnScroll', () => ({ useHideTabBarOnScroll: () => ({}) }));
// No debounce wait: the term applies at once.
jest.mock('../../../hooks/useDebounce', () => ({ useDebounce: (v: unknown) => v }));
// Runs the page-1 fetcher once, without the AsyncStorage layer.
jest.mock('../../../hooks/useQuery', () => {
  const r: typeof React = require('react');
  return {
    useQuery: (_key: unknown, fetcher: () => Promise<unknown>) => {
      const [data, setData] = r.useState<unknown>(undefined);
      r.useEffect(() => {
        void fetcher().then(setData);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return {
        data: data ?? null,
        loading: data === undefined,
        error: null,
        refresh: jest.fn(),
        revalidate: jest.fn(),
        isStale: false,
        updatedAt: null,
        mutate: jest.fn(),
      };
    },
    invalidateQuery: jest.fn(),
  };
});

const getErrandHistory = runnerService.getErrandHistory as jest.Mock;

const errand = (id: string): Booking =>
  ({
    id,
    booking_number: `EG-${id}`,
    status: 'completed',
    pickup_address: 'A',
    dropoff_address: 'B',
    runner_payout: 85,
    created_at: '2026-11-01T10:00:00Z',
    completed_at: '2026-11-01T11:00:00Z',
  }) as unknown as Booking;

const pageOf = (prefix: string, n: number) => ({
  data: { data: Array.from({ length: n }, (_, i) => errand(`${prefix}${i}`)) },
});

it('fetches the next page of a search with the term that is on screen now', async () => {
  getErrandHistory.mockResolvedValue(pageOf('p', 15));

  const screen = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <RunnerHistoryScreen />
    </SafeAreaProvider>,
  );
  await act(async () => {});

  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText('Search errands'), 'Ana');
  });
  await act(async () => {
    screen.UNSAFE_getByType(FlatList).props.onEndReached({ distanceFromEnd: 0 });
  });

  const nextPage = getErrandHistory.mock.calls.find(([p]) => p?.page === 2)?.[0];
  expect(nextPage).toEqual(expect.objectContaining({ page: 2, search: 'Ana' }));
});
