import { act } from '@testing-library/react-native';
import { useAuthStore } from '../authStore';
import { makeUser } from '../../__mocks__/factories';

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
});
