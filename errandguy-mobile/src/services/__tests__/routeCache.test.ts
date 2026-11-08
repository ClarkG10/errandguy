/**
 * Live-tracking route calls.
 *
 * On the runner's errand screen the map, its ETA badge and the step hero all
 * ask for the same leg in the same commit, and every live caller refetches
 * when the runner crosses a ~110 m cell (a 3-decimal snap). The cache used to
 * be keyed at 4 decimals and had no in-flight sharing, so up to three
 * identical HERE calls went out per cell. Route results also lived in
 * AsyncStorage under position-derived keys that were never read again.
 */
process.env.EXPO_PUBLIC_HERE_API_KEY = 'test-key';

import AsyncStorage from '@react-native-async-storage/async-storage';

// Canonical example from heremaps/flexible-polyline (precision 5).
const POLYLINE = 'BFoz5xJ67i1B1B7PzIhaxL7Y';

const okResponse = () => ({
  ok: true,
  json: async () => ({
    routes: [{ sections: [{ polyline: POLYLINE, summary: { length: 1200, duration: 300 } }] }],
  }),
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { routeService, __resetRouteCacheForTests } = require('../route.service') as typeof import('../route.service');

const fetchMock = jest.fn();
const realFetch = global.fetch;

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(async () => {
  __resetRouteCacheForTests();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => okResponse());
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const pickup = { lat: 14.5547, lng: 121.0244 };

it('shares one request between callers asking for the same leg at once', async () => {
  const origin = { lat: 14.6011, lng: 121.0011 };
  const results = await Promise.all([
    routeService.getRoute(origin, pickup),
    routeService.getRoute(origin, pickup),
    routeService.getRoute(origin, pickup),
  ]);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(results[0]).not.toBeNull();
  expect(results[1]).toBe(results[0]);
  expect(results[2]).toBe(results[0]);
});

const live = { liveOrigin: true } as const;

it('serves a moving runner’s GPS drift inside the same ~110 m cell from cache', async () => {
  await routeService.getRoute({ lat: 14.60112, lng: 121.00108 }, pickup, 'driving', live);
  // ~30 m of drift — a different 4-decimal key, the same 3-decimal one.
  const again = await routeService.getRoute({ lat: 14.60138, lng: 121.00131 }, pickup, 'driving', live);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(again?.durationSeconds).toBe(300);
});

it('fetches again once the runner moves into another cell', async () => {
  await routeService.getRoute({ lat: 14.6011, lng: 121.0011 }, pickup, 'driving', live);
  await routeService.getRoute({ lat: 14.6031, lng: 121.0011 }, pickup, 'driving', live);

  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('never lets two nearby pickup PINS share a route', async () => {
  // The customer nudged the pickup pin ~35 m: same 3-decimal cell, but a
  // fixed pin — the line must start at the new marker.
  await routeService.getRoute({ lat: 14.60112, lng: 121.00108 }, pickup);
  await routeService.getRoute({ lat: 14.60138, lng: 121.00131 }, pickup);

  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('never lets two nearby destinations share a route', async () => {
  const origin = { lat: 14.6011, lng: 121.0011 };
  await routeService.getRoute(origin, { lat: 14.5547, lng: 121.0244 });
  // A dropoff ~60 m from the pickup is a different leg.
  await routeService.getRoute(origin, { lat: 14.5552, lng: 121.0246 });

  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not cache a failure, so the next caller retries', async () => {
  fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  const origin = { lat: 14.6011, lng: 121.0011 };

  expect(await routeService.getRoute(origin, pickup)).toBeNull();
  expect(await routeService.getRoute(origin, pickup)).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps routes out of AsyncStorage', async () => {
  await routeService.getRoute({ lat: 14.6011, lng: 121.0011 }, pickup);

  const keys = await AsyncStorage.getAllKeys();
  expect(keys.filter((k) => k.includes('route'))).toEqual([]);
});

it('refreshRoute bypasses the cached entry', async () => {
  const origin = { lat: 14.6011, lng: 121.0011 };
  await routeService.getRoute(origin, pickup);
  await routeService.refreshRoute(origin, pickup);

  expect(fetchMock).toHaveBeenCalledTimes(2);
});

describe('a HERE call that stalls (Android fetch has no read timeout)', () => {
  /** A fetch that never answers — only an abort settles it. */
  const stall = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
    });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives up after ~12s, so "Retry route" makes a real new request', async () => {
    jest.useFakeTimers();
    const origin = { lat: 14.6011, lng: 121.0011 };
    fetchMock.mockImplementationOnce(stall);

    const first = routeService.getRoute(origin, pickup);
    // A retry while it hangs still shares it — one request per leg.
    const sharing = routeService.getRoute(origin, pickup);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(12_000);
    await expect(first).resolves.toBeNull();
    await expect(sharing).resolves.toBeNull();

    // The stalled entry is gone: the retry goes out and succeeds.
    const retry = await routeService.getRoute(origin, pickup);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retry?.durationSeconds).toBe(300);
  });

  it('a guided-navigation route gives up too, rather than spin forever', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementationOnce(stall);

    const nav = routeService.getNavigationRoute({ lat: 14.6011, lng: 121.0011 }, pickup);
    await jest.advanceTimersByTimeAsync(12_000);

    await expect(nav).resolves.toBeNull();
  });
});
