/**
 * Geocoding shares one in-flight request per key (CacheService.getOrFetch).
 * On Android a stalled fetch never settles, so that entry used to stay pinned
 * and every later lookup of the same pin or search got the same hung promise.
 */
process.env.EXPO_PUBLIC_HERE_API_KEY = 'test-key';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { geocodingService } = require('../geocoding.service') as typeof import('../geocoding.service');
import AsyncStorage from '@react-native-async-storage/async-storage';

const fetchMock = jest.fn();
const realFetch = global.fetch;

const stall = (_url: string, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  });

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});
beforeEach(async () => {
  fetchMock.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await AsyncStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('a stalled reverse lookup gives up after ~12s and the next one goes out fresh', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementationOnce(stall).mockImplementation(async () => ({
    ok: true,
    json: async () => ({ items: [{ address: { label: 'Ayala Ave, Makati' } }] }),
  }));

  const first = geocodingService.reverse(121.0244, 14.5547);
  await jest.advanceTimersByTimeAsync(12_000);
  // Falls back to the coordinates rather than hanging.
  await expect(first).resolves.toBe('14.554700, 121.024400');

  await expect(geocodingService.reverse(121.0244, 14.5547)).resolves.toBe('Ayala Ave, Makati');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('a stalled search gives up too', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementationOnce(stall);

  const results = geocodingService.search('Ayala Triangle');
  await jest.advanceTimersByTimeAsync(12_000);

  await expect(results).resolves.toEqual([]);
});
