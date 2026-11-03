/**
 * CacheService housekeeping.
 *
 * `get` only removes an expired entry when that exact key is read again, so
 * entries keyed by something that never recurs piled up for the life of the
 * install. Android caps AsyncStorage at 6 MB; past that every setItem throws
 * and `set` swallows it. `pruneExpired` is the once-per-launch sweep.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CacheService } from '../cache.service';

const PREFIX = '@errandguy_cache:';
const NOW = 1_700_000_000_000;

const entry = (expiresAt: number) => JSON.stringify({ data: { ok: true }, expiresAt });

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('pruneExpired', () => {
  it('removes expired and corrupt cache entries and keeps live ones', async () => {
    await AsyncStorage.multiSet([
      [`${PREFIX}live`, entry(NOW + 60_000)],
      [`${PREFIX}expired`, entry(NOW - 1)],
      [`${PREFIX}corrupt`, '{not json'],
      [`${PREFIX}no-expiry`, JSON.stringify({ data: 1 })],
    ]);

    const removed = await CacheService.pruneExpired(NOW);

    expect(removed).toBe(3);
    expect(await AsyncStorage.getAllKeys()).toEqual([`${PREFIX}live`]);
  });

  it('never touches keys outside the cache prefix', async () => {
    await AsyncStorage.multiSet([
      ['@errandguy:mutation_queue', '{not json'],
      ['auth_draft', JSON.stringify({ expiresAt: NOW - 1 })],
      [`${PREFIX}expired`, entry(NOW - 1)],
    ]);

    await CacheService.pruneExpired(NOW);

    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(
      ['@errandguy:mutation_queue', 'auth_draft'].sort(),
    );
  });

  it('works through more entries than one read chunk', async () => {
    const pairs: [string, string][] = [];
    for (let i = 0; i < 130; i++) {
      pairs.push([`${PREFIX}k${i}`, entry(i % 2 === 0 ? NOW - 1 : NOW + 60_000)]);
    }
    await AsyncStorage.multiSet(pairs);

    const removed = await CacheService.pruneExpired(NOW);

    expect(removed).toBe(65);
    expect(await AsyncStorage.getAllKeys()).toHaveLength(65);
  });

  it('never throws when storage itself fails', async () => {
    const spy = jest
      .spyOn(AsyncStorage, 'getAllKeys')
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(CacheService.pruneExpired(NOW)).resolves.toBe(0);
    spy.mockRestore();
  });
});

describe('getOrFetch', () => {
  it('shares one fetch between concurrent misses on the same key', async () => {
    let resolve: (v: string) => void = () => {};
    const fetcher = jest.fn(
      () => new Promise<string>((r) => {
        resolve = r;
      }),
    );

    const a = CacheService.getOrFetch('geo:1', fetcher);
    const b = CacheService.getOrFetch('geo:1', fetcher);
    // Let both get past the (async) cache read.
    await new Promise((r) => setImmediate(r));
    resolve('Makati');

    expect(await Promise.all([a, b])).toEqual(['Makati', 'Makati']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('lets the next caller retry after a failed fetch', async () => {
    const fetcher = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('Taguig');

    await expect(CacheService.getOrFetch('geo:2', fetcher)).rejects.toThrow('offline');
    await expect(CacheService.getOrFetch('geo:2', fetcher)).resolves.toBe('Taguig');
  });
});
