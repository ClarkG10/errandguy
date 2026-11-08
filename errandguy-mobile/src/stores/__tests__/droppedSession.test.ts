/**
 * Two ways a session ends WITHOUT an in-app sign-out: "Remember me" was off and
 * the app was closed, or "Not you?" on the login screen. Both used to drop the
 * token on this phone only — the server kept the sign-in, so the previous
 * account's pushes kept arriving and a runner could stay "online". Their
 * offline write queue also survived, to replay later.
 */
import { useAuthStore } from '../authStore';
import { secureStorage } from '../../utils/storage';
import { useMutationQueueStore } from '../../services/mutationQueue';

const mockLogout = jest.fn();
jest.mock('../../services/auth.service', () => ({
  authService: { logout: (...a: unknown[]) => mockLogout(...a) },
}));
const mockUnregister = jest.fn();
jest.mock('../../services/pushToken', () => ({
  currentPushToken: () => 'ExponentPushToken[abc]',
  unregisterPushLocally: (...a: unknown[]) => mockUnregister(...a),
}));

const mockSecureStore = jest.mocked(require('expo-secure-store'));

const queuedWrite = {
  id: 'q-1',
  kind: 'user.updateProfile',
  payload: { full_name: 'Ana' },
  createdAt: Date.now(),
  attempts: 0,
  userId: 'user-a',
};

const keychain = (values: Record<string, string | null>) =>
  mockSecureStore.getItemAsync.mockImplementation((key: string) =>
    Promise.resolve(values[key] ?? null),
  );

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockLogout.mockResolvedValue({ data: {} });
  mockUnregister.mockResolvedValue(undefined);
  secureStorage.clearCache();
  useAuthStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
    role: null,
    biometricLockPending: false,
  });
  useMutationQueueStore.setState({ pending: [queuedWrite], flushing: false });
});

describe('"Remember me" off, at a cold start', () => {
  it('ends the sign-in on the server with the OLD token, and lets go of push here', async () => {
    keychain({ auth_token: 'tok-old', session_persistent: 'false' });

    await useAuthStore.getState().loadFromStorage();
    await flush();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(mockLogout).toHaveBeenCalledWith('ExponentPushToken[abc]', 'tok-old');
    expect(mockUnregister).toHaveBeenCalled();
  });

  it('drops the offline write queue so none of it can replay', async () => {
    keychain({ auth_token: 'tok-old', session_persistent: 'false' });

    await useAuthStore.getState().loadFromStorage();

    expect(useMutationQueueStore.getState().pending).toEqual([]);
  });

  it('still cleans up here when the server cannot be reached', async () => {
    keychain({ auth_token: 'tok-old', session_persistent: 'false' });
    mockLogout.mockRejectedValue({ status: 0, kind: 'offline' });

    await useAuthStore.getState().loadFromStorage();
    await flush();

    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(mockUnregister).toHaveBeenCalled();
    expect(useMutationQueueStore.getState().pending).toEqual([]);
  });

  it('leaves a remembered session alone', async () => {
    keychain({ auth_token: 'tok-live' });

    await useAuthStore.getState().loadFromStorage();
    await flush();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockUnregister).not.toHaveBeenCalled();
    expect(useMutationQueueStore.getState().pending).toHaveLength(1);
  });
});

describe('"Not you?" on the login screen', () => {
  it('ends the held sign-in on the server, lets go of push, and drops the queue', async () => {
    keychain({ auth_token: 'tok-old', biometric_enabled: 'true' });

    await useAuthStore.getState().clearBiometricSession();
    await flush();

    expect(mockLogout).toHaveBeenCalledWith('ExponentPushToken[abc]', 'tok-old');
    expect(mockUnregister).toHaveBeenCalled();
    expect(useMutationQueueStore.getState().pending).toEqual([]);
    expect(useAuthStore.getState().biometricEnabled).toBe(false);
  });

  it('with no session held, still cleans up here but calls nobody', async () => {
    keychain({});

    await useAuthStore.getState().clearBiometricSession();
    await flush();

    expect(mockLogout).not.toHaveBeenCalled();
    expect(useMutationQueueStore.getState().pending).toEqual([]);
  });
});

describe('loadFromStorage when storage fails', () => {
  it('starts signed out and always ends loading, so the splash hides', async () => {
    mockSecureStore.getItemAsync.mockRejectedValue(new Error('keychain unavailable'));

    await expect(useAuthStore.getState().loadFromStorage()).resolves.toBeUndefined();

    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
  });
});
