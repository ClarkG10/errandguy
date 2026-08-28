import { act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore, parseUserSnapshot } from '../authStore';
import { secureStorage } from '../../utils/storage';
import { makeUser } from '../../__mocks__/factories';

const USER_SNAPSHOT_KEY = '@user_snapshot_v1';
const LAST_ACCOUNT_KEY = '@last_account_id';

// Get mocked SecureStore
const mockSecureStore = jest.mocked(require('expo-secure-store'));

// Reset store between tests
beforeEach(() => {
  useAuthStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
    role: null,
  });
  jest.clearAllMocks();
  // secureStorage keeps a module-level read-through cache that survives
  // between cases (the module is a singleton per test file). Without this,
  // an earlier setToken/logout leaves 'auth_token' cached, short-circuiting
  // the mocked getItemAsync in loadFromStorage.
  secureStorage.clearCache();
});

describe('authStore', () => {
  describe('setUser', () => {
    it('sets user and marks authenticated', () => {
      const user = makeUser();
      act(() => useAuthStore.getState().setUser(user));

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.isAuthenticated).toBe(true);
      expect(state.role).toBe('customer');
    });

    it('sets role from user role', () => {
      const runner = makeUser({ role: 'runner' });
      act(() => useAuthStore.getState().setUser(runner));

      expect(useAuthStore.getState().role).toBe('runner');
    });

    it('clears user when null is passed', () => {
      act(() => useAuthStore.getState().setUser(makeUser()));
      act(() => useAuthStore.getState().setUser(null));

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.role).toBeNull();
    });
  });

  describe('setToken', () => {
    it('stores token in SecureStore', async () => {
      await act(() => useAuthStore.getState().setToken('my-token'));

      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'my-token');
      expect(useAuthStore.getState().token).toBe('my-token');
    });

    it('deletes token from SecureStore when null', async () => {
      await act(() => useAuthStore.getState().setToken(null));

      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
      expect(useAuthStore.getState().token).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears all auth state and deletes token', async () => {
      act(() => {
        useAuthStore.setState({
          user: makeUser(),
          token: 'abc',
          isAuthenticated: true,
          role: 'customer',
          isLoading: false,
        });
      });

      await act(() => useAuthStore.getState().logout());

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.role).toBeNull();
      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
    });
  });

  describe('loadFromStorage', () => {
    it('loads token from SecureStore and sets isAuthenticated', async () => {
      mockSecureStore.getItemAsync.mockResolvedValueOnce('stored-token');

      await act(() => useAuthStore.getState().loadFromStorage());

      const state = useAuthStore.getState();
      expect(state.token).toBe('stored-token');
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('sets isAuthenticated false when no token in storage', async () => {
      mockSecureStore.getItemAsync.mockResolvedValueOnce(null);

      await act(() => useAuthStore.getState().loadFromStorage());

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('updateProfile', () => {
    it('merges partial data into current user', () => {
      act(() => useAuthStore.getState().setUser(makeUser({ full_name: 'Old Name' })));
      act(() => useAuthStore.getState().updateProfile({ full_name: 'New Name' }));

      expect(useAuthStore.getState().user?.full_name).toBe('New Name');
    });

    it('does nothing when user is null', () => {
      act(() => useAuthStore.getState().updateProfile({ full_name: 'Nobody' }));
      expect(useAuthStore.getState().user).toBeNull();
    });
  });

  describe('persistence', () => {
    it('initial state has correct defaults', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.role).toBeNull();
    });
  });

  // Boot snapshot: the non-secret {id, role, full_name, avatar_url} that lets a
  // cold start route to the right navigator (and paint home from cache) without
  // waiting on the /user/profile round-trip.
  describe('boot snapshot', () => {
    /** Backing values for the mocked SecureStore, keyed exactly as stored. */
    let secureValues: Record<string, string | null>;

    beforeEach(async () => {
      await AsyncStorage.clear();
      secureValues = {};
      mockSecureStore.getItemAsync.mockImplementation((key: string) =>
        Promise.resolve(secureValues[key] ?? null),
      );
      mockSecureStore.setItemAsync.mockImplementation((key: string, value: string) => {
        secureValues[key] = value;
        return Promise.resolve();
      });
      mockSecureStore.deleteItemAsync.mockImplementation((key: string) => {
        secureValues[key] = null;
        return Promise.resolve();
      });
    });

    const readSnapshot = async () => {
      const raw = await AsyncStorage.getItem(USER_SNAPSHOT_KEY);
      return raw ? JSON.parse(raw) : null;
    };

    describe('parseUserSnapshot', () => {
      it('rebuilds a User with neutral placeholders for the unpersisted fields', () => {
        const user = parseUserSnapshot(
          JSON.stringify({ id: 'u1', role: 'runner', full_name: 'Juan', avatar_url: 'a.png' }),
        );
        expect(user).toMatchObject({
          id: 'u1',
          role: 'runner',
          full_name: 'Juan',
          avatar_url: 'a.png',
          phone: null,
          email: null,
          wallet_balance: 0,
        });
      });

      it.each([
        ['null input', null],
        ['non-JSON', 'not json'],
        ['an unknown role', JSON.stringify({ id: 'u1', role: 'admin' })],
        ['a missing role', JSON.stringify({ id: 'u1' })],
        ['a missing id', JSON.stringify({ role: 'customer' })],
      ])('returns null for %s', (_label, raw) => {
        expect(parseUserSnapshot(raw)).toBeNull();
      });
    });

    it('setUser persists only the non-secret fields', async () => {
      act(() =>
        useAuthStore.getState().setUser(
          makeUser({ id: 'u1', role: 'runner', full_name: 'Juan Dela Cruz', avatar_url: 'a.png' }),
        ),
      );

      await waitFor(async () => expect(await readSnapshot()).not.toBeNull());
      const snapshot = await readSnapshot();
      expect(snapshot).toEqual({
        id: 'u1',
        role: 'runner',
        full_name: 'Juan Dela Cruz',
        avatar_url: 'a.png',
      });
      // PII / money figures must never reach unencrypted AsyncStorage.
      expect(Object.keys(snapshot)).not.toEqual(
        expect.arrayContaining(['phone', 'email', 'wallet_balance']),
      );
    });

    it('updateProfile keeps the snapshot in step with a name change', async () => {
      act(() => useAuthStore.getState().setUser(makeUser({ id: 'u1', full_name: 'Old' })));
      await waitFor(async () => expect(await readSnapshot()).not.toBeNull());

      act(() => useAuthStore.getState().updateProfile({ full_name: 'New' }));
      await waitFor(async () => expect((await readSnapshot())?.full_name).toBe('New'));
    });

    it('loadFromStorage hydrates user + role before isLoading flips', async () => {
      secureValues.auth_token = 'tok';
      await AsyncStorage.setItem(
        USER_SNAPSHOT_KEY,
        JSON.stringify({ id: 'u1', role: 'runner', full_name: 'Juan', avatar_url: null }),
      );
      await AsyncStorage.setItem(LAST_ACCOUNT_KEY, 'u1');

      await act(() => useAuthStore.getState().loadFromStorage());

      const state = useAuthStore.getState();
      expect(state.role).toBe('runner');
      expect(state.user?.id).toBe('u1');
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    /**
     * The snapshot holds no runner_profile, so a gate that reads it off a
     * snapshot-hydrated user cannot tell "not loaded yet" from the server
     * saying "no profile" — which sent every approved runner to the KYC
     * document-upload screen on cold start. `userIsProvisional` is what the
     * runner layout waits on; these pin it in both directions.
     */
    it('marks a snapshot-hydrated user provisional', async () => {
      secureValues.auth_token = 'tok';
      await AsyncStorage.setItem(
        USER_SNAPSHOT_KEY,
        JSON.stringify({ id: 'u1', role: 'runner', full_name: 'Juan', avatar_url: null }),
      );
      await AsyncStorage.setItem(LAST_ACCOUNT_KEY, 'u1');

      await act(() => useAuthStore.getState().loadFromStorage());

      expect(useAuthStore.getState().userIsProvisional).toBe(true);
      // The very field the runner gate reads is absent — hence provisional.
      expect(useAuthStore.getState().user?.runner_profile).toBeUndefined();
    });

    it('clears the provisional flag once a real profile arrives via setUser', async () => {
      secureValues.auth_token = 'tok';
      await AsyncStorage.setItem(
        USER_SNAPSHOT_KEY,
        JSON.stringify({ id: 'u1', role: 'runner', full_name: 'Juan', avatar_url: null }),
      );
      await AsyncStorage.setItem(LAST_ACCOUNT_KEY, 'u1');
      await act(() => useAuthStore.getState().loadFromStorage());
      expect(useAuthStore.getState().userIsProvisional).toBe(true);

      act(() =>
        useAuthStore.getState().setUser({
          ...(useAuthStore.getState().user as NonNullable<
            ReturnType<typeof useAuthStore.getState>['user']
          >),
          runner_profile: { verification_status: 'approved' } as never,
        }),
      );

      expect(useAuthStore.getState().userIsProvisional).toBe(false);
    });

    it('does not hydrate when there is no persisted token', async () => {
      await AsyncStorage.setItem(
        USER_SNAPSHOT_KEY,
        JSON.stringify({ id: 'u1', role: 'runner', full_name: 'Juan', avatar_url: null }),
      );

      await act(() => useAuthStore.getState().loadFromStorage());

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().role).toBeNull();
    });

    it('does not hydrate behind a pending biometric lock', async () => {
      secureValues.auth_token = 'tok';
      secureValues.biometric_enabled = 'true';
      await AsyncStorage.setItem(
        USER_SNAPSHOT_KEY,
        JSON.stringify({ id: 'u1', role: 'runner', full_name: 'Juan', avatar_url: null }),
      );

      await act(() => useAuthStore.getState().loadFromStorage());

      const state = useAuthStore.getState();
      expect(state.biometricLockPending).toBe(true);
      expect(state.user).toBeNull();
      expect(state.role).toBeNull();
    });

    it('ignores a snapshot belonging to a different resident account', async () => {
      secureValues.auth_token = 'tok';
      await AsyncStorage.setItem(
        USER_SNAPSHOT_KEY,
        JSON.stringify({ id: 'u1', role: 'runner', full_name: 'Juan', avatar_url: null }),
      );
      await AsyncStorage.setItem(LAST_ACCOUNT_KEY, 'someone-else');

      await act(() => useAuthStore.getState().loadFromStorage());

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().role).toBeNull();
    });

    it('logout purges the snapshot', async () => {
      act(() => useAuthStore.getState().setUser(makeUser({ id: 'u1' })));
      await waitFor(async () => expect(await readSnapshot()).not.toBeNull());

      await act(() => useAuthStore.getState().logout());

      expect(await AsyncStorage.getItem(USER_SNAPSHOT_KEY)).toBeNull();
    });

    it('a different account signing in replaces the previous snapshot', async () => {
      act(() => useAuthStore.getState().setUser(makeUser({ id: 'u1', role: 'runner' })));
      await waitFor(async () => expect((await readSnapshot())?.id).toBe('u1'));

      act(() => useAuthStore.getState().setUser(makeUser({ id: 'u2', role: 'customer' })));
      await waitFor(async () => expect((await readSnapshot())?.id).toBe('u2'));
      expect((await readSnapshot())?.role).toBe('customer');
    });
  });
});
