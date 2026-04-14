import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '../utils/storage';
import type { User, UserRole } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: UserRole | null;
  onboardingSeen: boolean;

  setUser: (user: User | null) => void;
  setToken: (token: string | null) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  updateProfile: (data: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  role: null,
  onboardingSeen: false,

  setUser: (user) =>
    set({
      user,
      role: user?.role ?? null,
      isAuthenticated: !!user,
    }),

  setToken: async (token) => {
    if (token) {
      await secureStorage.set('auth_token', token);
    } else {
      await secureStorage.remove('auth_token');
    }
    set({ token });
  },

  logout: async () => {
    await secureStorage.remove('auth_token');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      role: null,
    });
  },

  loadFromStorage: async () => {
    set({ isLoading: true });
    const [token, onboardingSeen] = await Promise.all([
      secureStorage.get('auth_token'),
      AsyncStorage.getItem('@onboarding_seen'),
    ]);
    set({
      token,
      isAuthenticated: !!token,
      onboardingSeen: onboardingSeen === 'true',
      isLoading: false,
    });
  },

  updateProfile: (data) => {
    const currentUser = get().user;
    if (currentUser) {
      set({ user: { ...currentUser, ...data } });
    }
  },
}));
