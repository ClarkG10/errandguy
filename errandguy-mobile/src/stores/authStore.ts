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
  runnerOnboardingSkipped: boolean;
  rememberedCredentials: { identifier: string; password: string } | null;

  setUser: (user: User | null) => void;
  setToken: (token: string | null) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  updateProfile: (data: Partial<User>) => void;
  setRunnerOnboardingSkipped: (skipped: boolean) => Promise<void>;
  setRememberedCredentials: (creds: { identifier: string; password: string } | null) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  role: null,
  onboardingSeen: false,
  runnerOnboardingSkipped: false,
  rememberedCredentials: null,

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

  setRunnerOnboardingSkipped: async (skipped) => {
    if (skipped) {
      await AsyncStorage.setItem('@runner_onboarding_skipped', 'true');
    } else {
      await AsyncStorage.removeItem('@runner_onboarding_skipped');
    }
    set({ runnerOnboardingSkipped: skipped });
  },

  setRememberedCredentials: async (creds) => {
    if (creds) {
      await secureStorage.set('remembered_credentials', JSON.stringify(creds));
    } else {
      await secureStorage.remove('remembered_credentials');
    }
    set({ rememberedCredentials: creds });
  },

  logout: async () => {
    await secureStorage.remove('auth_token');
    await AsyncStorage.removeItem('@runner_onboarding_skipped');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      role: null,
    });
  },

  loadFromStorage: async () => {
    set({ isLoading: true });
    const [token, onboardingSeen, runnerSkipped, rememberedRaw] = await Promise.all([
      secureStorage.get('auth_token'),
      AsyncStorage.getItem('@onboarding_seen'),
      AsyncStorage.getItem('@runner_onboarding_skipped'),
      secureStorage.get('remembered_credentials'),
    ]);
    let rememberedCredentials = null;
    if (rememberedRaw) {
      try { rememberedCredentials = JSON.parse(rememberedRaw); } catch {}
    }
    set({
      token,
      isAuthenticated: !!token,
      onboardingSeen: onboardingSeen === 'true',
      runnerOnboardingSkipped: runnerSkipped === 'true',
      rememberedCredentials,
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
