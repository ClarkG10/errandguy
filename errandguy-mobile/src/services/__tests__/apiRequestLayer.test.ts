/**
 * The GET layer in services/api.ts (in-flight dedupe, ETag revalidation,
 * 5xx retry) never ran: axios 1.x binds `api.get/post/…` to its inner context,
 * so they called that context's `request`, not the patched `api.request`. Only
 * the interceptors ran.
 *
 * These drive the REAL axios instance through a stub adapter, so they exercise
 * exactly what a screen's `api.get` does.
 */
import { AxiosError } from 'axios';
import api, { apiCache } from '../api';
import { useNetworkStore } from '../../stores/networkStore';

type Reply =
  | { status: number; data?: unknown; headers?: Record<string, string> }
  | { fail: 'timeout' | 'network' };

const adapter = jest.fn();
let replies: Reply[] = [];

/** Answer the way axios's own adapters do: resolve or reject by validateStatus. */
function answer(config: any): Promise<any> {
  const reply = replies.shift() ?? { status: 200, data: { ok: true } };
  if ('fail' in reply) {
    return Promise.reject(
      reply.fail === 'timeout'
        ? new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', config, {})
        : new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {}),
    );
  }
  const response = {
    data: reply.data ?? {},
    status: reply.status,
    statusText: String(reply.status),
    headers: reply.headers ?? {},
    config,
    request: {},
  };
  const valid = config.validateStatus ?? ((s: number) => s >= 200 && s < 300);
  if (valid(reply.status)) return Promise.resolve(response);
  return Promise.reject(
    new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, response as any),
  );
}

beforeEach(() => {
  replies = [];
  adapter.mockReset();
  adapter.mockImplementation(answer);
  api.defaults.adapter = adapter as any;
  apiCache.clear();
  useNetworkStore.setState({ isOffline: false, lastChangedAt: null });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the verb helpers go through the request wrapper', () => {
  it('api.get reaches api.request', async () => {
    const spy = jest.spyOn(api, 'request');
    await api.get('/ping', { params: { a: 1 } });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'get', url: '/ping', params: { a: 1 } }),
    );
  });

  it('api.post reaches api.request with its body', async () => {
    const spy = jest.spyOn(api, 'request');
    await api.post('/things', { name: 'x' }, { silent: true });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'post', url: '/things', data: { name: 'x' }, silent: true }),
    );
  });
});

describe('in-flight dedupe', () => {
  it('two concurrent identical GETs make one request', async () => {
    const [a, b] = await Promise.all([api.get('/bookings/1'), api.get('/bookings/1')]);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual(b.data);
  });

  it('different params are different requests', async () => {
    await Promise.all([
      api.get('/bookings', { params: { page: 1 } }),
      api.get('/bookings', { params: { page: 2 } }),
    ]);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('a read issued after a write does not join a GET that started before it', async () => {
    let release!: () => void;
    adapter.mockImplementationOnce(
      (config: any) =>
        new Promise((resolve) => {
          release = () =>
            resolve({ data: { v: 'before' }, status: 200, statusText: '', headers: {}, config });
        }),
    );
    const early = api.get('/bookings/1');
    await api.post('/bookings/1/cancel', {});
    replies.push({ status: 200, data: { v: 'after' } });
    const late = api.get('/bookings/1');
    release();
    expect((await early).data).toEqual({ v: 'before' });
    expect((await late).data).toEqual({ v: 'after' });
  });
});

describe('micro-cache is opt-in', () => {
  it('serves nothing from cache by default', async () => {
    replies.push({ status: 200, data: { n: 1 } }, { status: 200, data: { n: 2 } });
    const first = await api.get('/runner/feed');
    const second = await api.get('/runner/feed');
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(first.data).toEqual({ n: 1 });
    expect(second.data).toEqual({ n: 2 });
  });

  it('does not serve from a time cache yet, even when a caller passes cacheTtlMs', async () => {
    // The per-call TTLs were written for a cache that never ran; until each
    // is checked on a phone, every read goes to the network (TIME_CACHE_ENABLED).
    replies.push({ status: 200, data: { n: 1 } }, { status: 200, data: { n: 2 } });
    await api.get('/errand-types', { cacheTtlMs: 60_000 });
    const again = await api.get('/errand-types', { cacheTtlMs: 60_000 });
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(again.data).toEqual({ n: 2 });
  });

  it('a write drops the cached read for the same resource', async () => {
    await api.get('/user/addresses', { cacheTtlMs: 60_000 });
    await api.post('/user/addresses', { label: 'Home' });
    await api.get('/user/addresses', { cacheTtlMs: 60_000 });
    // GET, POST, GET — the second GET was not served from cache.
    expect(adapter).toHaveBeenCalledTimes(3);
  });
});

describe('retry', () => {
  it('retries a GET that hit a 5xx', async () => {
    jest.useFakeTimers();
    replies.push({ status: 503 }, { status: 200, data: { ok: 'second try' } });
    const p = api.get('/bookings/active');
    await jest.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toEqual(expect.objectContaining({ data: { ok: 'second try' } }));
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('never retries a mutation', async () => {
    replies.push({ status: 503 });
    await expect(api.post('/bookings', {})).rejects.toEqual(expect.objectContaining({ status: 503 }));
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('retries a GET that timed out — a slow server is worth a second try', async () => {
    jest.useFakeTimers();
    replies.push({ fail: 'timeout' }, { status: 200, data: { ok: true } });
    const p = api.get('/bookings/active');
    await jest.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toEqual(expect.objectContaining({ data: { ok: true } }));
    expect(adapter).toHaveBeenCalledTimes(2);
  });
});

describe('a timeout is not "offline"', () => {
  it('does not flip the offline flag', async () => {
    replies.push({ fail: 'timeout' });
    await expect(api.get('/slow', { retries: 0 })).rejects.toEqual(
      expect.objectContaining({ status: 0, kind: 'timeout' }),
    );
    expect(useNetworkStore.getState().isOffline).toBe(false);
  });

  it('a real no-response transport error still does', async () => {
    replies.push({ fail: 'network' });
    await expect(api.get('/gone', { retries: 0 })).rejects.toEqual(
      expect.objectContaining({ status: 0, kind: 'offline' }),
    );
    expect(useNetworkStore.getState().isOffline).toBe(true);
  });
});

describe('conditional GET (ETag)', () => {
  it('revalidates with If-None-Match and reuses the body on a 304', async () => {
    replies.push(
      { status: 200, data: { feed: [1, 2] }, headers: { etag: '"v1"' } },
      { status: 304 },
    );
    await api.get('/runner/feed');
    const second = await api.get('/runner/feed');

    const sent = adapter.mock.calls[1][0];
    const ifNoneMatch =
      typeof sent.headers?.get === 'function'
        ? sent.headers.get('If-None-Match')
        : sent.headers?.['If-None-Match'];
    expect(ifNoneMatch).toBe('"v1"');
    expect(second.data).toEqual({ feed: [1, 2] });
  });
});
