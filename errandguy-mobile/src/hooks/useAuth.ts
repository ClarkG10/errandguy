import { useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { authService } from '../services/auth.service';
import { preloadAfterAuth } from '../services/preload.service';

export function useAuth() {
  // Per-field selectors, not a whole-store destructure: useAuthStore() with no
  // selector subscribes every consumer of this hook (login/register/profile/
  // route-gate screens) to the ENTIRE store, so unrelated writes (remember-me,
  // biometric toggle, onboarding flags) re-render all of them. Action refs are
  // stable, so the useCallback deps below keep their identity.
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const role = useAuthStore((s) => s.role);
  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const clearAuth = useAuthStore((s) => s.logout);
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const login = useCallback(
    async (data: { phone?: string; email?: string; password: string }) => {
      const response = await authService.login(data);
      const { user: userData, token: authToken } = response.data;
      await setToken(authToken);
      setUser(userData);
      await preloadAfterAuth(userData?.role ?? null, userData?.id);
      return userData;
    },
    [setToken, setUser],
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      await clearAuth();
    }
  }, [clearAuth]);

  const register = useCallback(
    async (data: {
      phone?: string;
      email?: string;
      password: string;
      full_name: string;
    }) => {
      const response = await authService.register(data);
      const { user: userData, token: authToken } = response.data;
      await setToken(authToken);
      setUser(userData);
      await preloadAfterAuth(userData?.role ?? null, userData?.id);
      return userData;
    },
    [setToken, setUser],
  );

  const socialLogin = useCallback(
    async (provider: 'google' | 'facebook', providerToken: string) => {
      const response = await authService.socialLogin(provider, providerToken);
      const { user: userData, token: authToken } = response.data;
      await setToken(authToken);
      setUser(userData);
      await preloadAfterAuth(userData?.role ?? null, userData?.id);
      return userData;
    },
    [setToken, setUser],
  );

  return {
    user,
    token,
    isAuthenticated,
    isLoading,
    role,
    login,
    logout,
    register,
    socialLogin,
    loadFromStorage,
    updateProfile,
  };
}
