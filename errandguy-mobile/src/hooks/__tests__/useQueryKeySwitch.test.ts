import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '../useQuery';
import { CacheService } from '../../services/cache.service';

/**
 * Switching a query's key while its request is in flight (another period on
 * Earnings, another search term) used to hand the new key the OLD request:
 * the new key was never fetched and the old answer showed under the new
 * label — a week's earnings shown as "This month's". Each key now gets its
 * own request, and a request for a key the screen has left only caches.
 */

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('fetches the new key and never shows the old key’s late answer', async () => {
  let resolveWeek: (v: string) => void = () => {};
  const fetchers: Record<string, () => Promise<string>> = {
    week: () => new Promise<string>((r) => { resolveWeek = r; }),
    month: () => Promise.resolve('month total'),
  };
  const calls: string[] = [];

  const { result, rerender } = renderHook(
    ({ period }: { period: string }) =>
      useQuery(['earnings', period], () => {
        calls.push(period);
        return fetchers[period]();
      }),
    { initialProps: { period: 'week' } },
  );
  await waitFor(() => expect(calls).toEqual(['week']));

  // The runner taps "This month" while the week request is still out.
  rerender({ period: 'month' });
  await waitFor(() => expect(result.current.data).toBe('month total'));
  expect(calls).toEqual(['week', 'month']);

  // The week answer lands late: cached for the week, not shown for the month.
  await act(async () => {
    resolveWeek('week total');
  });
  expect(result.current.data).toBe('month total');
  await waitFor(async () =>
    expect((await CacheService.get<{ value: string }>('q:earnings:week'))?.value).toBe('week total'),
  );
});
