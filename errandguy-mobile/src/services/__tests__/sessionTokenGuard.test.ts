/**
 * A response can land after the session it belonged to is gone. Its 401 (or
 * the rotated token it carries) speaks for THAT session, and used to end — or
 * overwrite the token of — whoever had signed in since.
 *
 * Driven through the real axios instance and interceptors with a stub adapter.
 */
import { AxiosError } from 'axios';
import api, { apiCache, SIGNED_OUT_REASON } from '../api';
import { secureStorage } from '../../utils/storage';
import { useAuthStore } from '../../stores/authStore';
import { useNetworkStore } from '../../stores/networkStore';

const adapter = jest.fn();

const reply = (config: any, status: number, headers: Record<string, string> = {}) => {
  const response = { data: {}, status, statusText: String(status), headers, config, request: {} };
  if (status >= 200 && status < 300) return Promise.resolve(response);
  return Promise.reject(
    new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, {}, response as any),
  );
};

const bearerOf = (config: any): string | undefined => {
  const h = config.headers;
  return typeof h?.get === 'function' ? h.get('Authorization') : h?.Authorization;
};

/** Hold the next request until `release(status)` is called. */
function holdNext(): { release: (status: number, headers?: Record<string, string>) => void } {
  let release!: (status: number, headers?: Record<string, string>) => void;
  adapter.mockImplementationOnce(
    (config: any) =>
      new Promise((resolve, reject) => {
        release = (status, headers) => reply(config, status, headers).then(resolve, reject);
      }),
  );
  return { release: (status, headers) => release(status, headers) };
}

const signedInAs = async (id: string, token: string) => {
  await secureStorage.set('auth_token', token);
  useAuthStore.setState({
    user: { id } as any,
    token,
    isAuthenticated: true,
    role: 'customer',
    sessionEndedReason: null,
    biometricLockPending: false,
  });
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  adapter.mockReset();
  adapter.mockImplementation((config: any) => reply(config, 200));
  api.defaults.adapter = adapter as any;
  apiCache.clear();
  secureStorage.clearCache();
  useNetworkStore.setState({ isOffline: false, lastChangedAt: null });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a 401', () => {
  it('for the token in use ends the session and says so', async () => {
    await signedInAs('user-a', 'tok-a');
    adapter.mockImplementationOnce((config: any) => reply(config, 401));

    await expect(api.get('/bookings', { retries: 0 })).rejects.toEqual(
      expect.objectContaining({ status: 401 }),
    );

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().sessionEndedReason).toBe(SIGNED_OUT_REASON);
    expect(secureStorage.peek('auth_token')).toBeNull();
  });

  it('says nothing that claims a suspension', () => {
    expect(SIGNED_OUT_REASON).toBe("You've been signed out. Please sign in again.");
    expect(SIGNED_OUT_REASON).not.toMatch(/suspend|banned|deleted/i);
  });

  it('for an OLDER token does not end the session that replaced it', async () => {
    await signedInAs('user-a', 'tok-a');
    const late = holdNext();
    const p = api.get('/notifications', { retries: 0 });
    await flush(); // let the request interceptor stamp tok-a

    // User A is signed out; user B signs in before A's request comes back.
    await signedInAs('user-b', 'tok-b');
    late.release(401);
    await expect(p).rejects.toEqual(expect.objectContaining({ status: 401 }));

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.id).toBe('user-b');
    expect(useAuthStore.getState().sessionEndedReason).toBeNull();
    expect(secureStorage.peek('auth_token')).toBe('tok-b');
  });

  it('on a request sent with no token at all changes nothing', async () => {
    await secureStorage.remove('auth_token');
    useAuthStore.setState({ isAuthenticated: false, sessionEndedReason: null });
    adapter.mockImplementationOnce((config: any) => reply(config, 401));

    await expect(api.post('/auth/login', {})).rejects.toEqual(
      expect.objectContaining({ status: 401 }),
    );
    expect(useAuthStore.getState().sessionEndedReason).toBeNull();
  });

  it('behind a pending biometric unlock drops the token without a toast — they never got in', async () => {
    await secureStorage.set('auth_token', 'tok-a');
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      biometricLockPending: true,
      sessionEndedReason: null,
    });
    adapter.mockImplementationOnce((config: any) => reply(config, 401));

    await expect(api.get('/user/profile', { retries: 0 })).rejects.toBeTruthy();

    expect(secureStorage.peek('auth_token')).toBeNull();
    expect(useAuthStore.getState().sessionEndedReason).toBeNull();
  });
});

describe('a rotated token (X-New-Token)', () => {
  it('is adopted from a response to the token in use', async () => {
    await signedInAs('user-a', 'tok-a');
    adapter.mockImplementationOnce((config: any) => reply(config, 200, { 'x-new-token': 'tok-a2' }));

    await api.get('/bookings');

    expect(secureStorage.peek('auth_token')).toBe('tok-a2');
    expect(useAuthStore.getState().token).toBe('tok-a2');
  });

  it("is NOT adopted from a late response to an older session's token", async () => {
    await signedInAs('user-a', 'tok-a');
    const late = holdNext();
    const p = api.get('/bookings');
    await flush();

    await signedInAs('user-b', 'tok-b');
    late.release(200, { 'x-new-token': 'tok-a2' });
    await p;

    expect(secureStorage.peek('auth_token')).toBe('tok-b');
    expect(useAuthStore.getState().token).toBe('tok-b');
  });
});

describe('a request that names its own bearer', () => {
  it('keeps it, even while another session is signed in', async () => {
    await signedInAs('user-b', 'tok-b');

    await api.post('/auth/logout', {}, { headers: { Authorization: 'Bearer tok-old' } });

    expect(bearerOf(adapter.mock.calls[0][0])).toBe('Bearer tok-old');
  });

  it('every other request carries the current token', async () => {
    await signedInAs('user-b', 'tok-b');
    await api.get('/bookings');
    expect(bearerOf(adapter.mock.calls[0][0])).toBe('Bearer tok-b');
  });
});
