import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { invalidateQuery, useQuery } from '../useQuery';
import { CacheService } from '../../services/cache.service';

/**
 * After a cancel, Home kept showing the cancelled errand ("Runner matched —
 * confirming…") and the wallet its old balance until the app was reloaded.
 * invalidateQuery's storage wipe is asynchronous and unawaited, so the answer
 * from before the mutation could still win: a fetch already on the way, or a
 * stored entry a freshly mounted screen read before the wipe finished.
 */

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

it('drops an answer that was on the way when the query was invalidated', async () => {
  const answers: Array<(v: string) => void> = [];
  const { result } = renderHook(() =>
    useQuery(['booking', 'active', 'u1'], () => new Promise<string>((r) => answers.push(r))),
  );
  await waitFor(() => expect(answers).toHaveLength(1));

  // The cancel lands while the first read (from before it) is still out.
  await act(async () => {
    await invalidateQuery(['booking', 'active']);
  });
  // The invalidation fetched again rather than joining the old read.
  expect(answers).toHaveLength(2);

  await act(async () => {
    answers[1]('cancelled');
  });
  await act(async () => {
    answers[0]('still active'); // the old read answers last
  });

  expect(result.current.data).toBe('cancelled');
  expect((await CacheService.get<{ value: string }>('q:booking:active:u1'))?.value).toBe('cancelled');
});

it('a screen mounting before the wipe finishes ignores the old stored answer', async () => {
  await CacheService.set('q:wallet:balance:u1', { value: 406.33, fetchedAt: Date.now() - 1000 }, 60_000);
  // The wipe hasn't happened yet (it is asynchronous and nobody waits for it).
  jest.spyOn(CacheService, 'removeByPrefix').mockImplementation(() => new Promise(() => {}));
  void invalidateQuery(['wallet']);

  const fetcher = jest.fn(() => Promise.resolve(500));
  const { result } = renderHook(() => useQuery(['wallet', 'balance', 'u1'], fetcher));

  await waitFor(() => expect(result.current.data).toBe(500));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('still serves a stored answer written after the invalidation', async () => {
  void invalidateQuery(['errand-types']);
  await new Promise((r) => setTimeout(r, 5));
  await CacheService.set('q:errand-types', { value: ['delivery'], fetchedAt: Date.now() }, 60_000);

  const fetcher = jest.fn(() => Promise.resolve(['fresh']));
  const { result } = renderHook(() => useQuery(['errand-types'], fetcher, { staleTime: 60_000 }));

  await waitFor(() => expect(result.current.data).toEqual(['delivery']));
  expect(fetcher).not.toHaveBeenCalled();
});
