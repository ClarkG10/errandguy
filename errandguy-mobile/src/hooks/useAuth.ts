import { useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { authService } from '../services/auth.service';

export function useAuth() {
  const {
    user,
    token,
    isAuthenticated,
    isLoading,
    role,
    setUser,
    setToken,
    logout: clearAuth,
    loadFromStorage,
    updateProfile,
  } = useAuthStore();

  const login = useCallback(
    async (data: { phone?: string; email?: string; password: string }) => {
      const response = await authService.login(data);
      const { user: userData, token: authToken } = response.data;
      await setToken(authToken);
      setUser(userData);
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
      role: 'customer' | 'runner';
    }) => {
      const response = await authService.register(data);
      const { user: userData, token: authToken } = response.data;
      await setToken(authToken);
      setUser(userData);
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
