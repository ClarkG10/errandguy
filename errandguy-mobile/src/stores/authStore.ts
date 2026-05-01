import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '../utils/storage';
import { geocodingService } from '../services/geocoding.service';
import { CacheService } from '../services/cache.service';
import { apiCache } from '../services/api';
import type { User, UserRole } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: UserRole | null;
  onboardingSeen: boolean;
  runnerOnboardingSkipped: boolean;
  rememberedCredentials: { identifier: string } | null;

  setUser: (user: User | null) => void;
  setToken: (token: string | null) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  updateProfile: (data: Partial<User>) => void;
  setRunnerOnboardingSkipped: (skipped: boolean) => Promise<void>;
  setRememberedCredentials: (creds: { identifier: string } | null) => Promise<void>;
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
    // SECURITY: We deliberately persist ONLY the identifier (phone/email),
    // never the password. Storing the password — even in the device
    // keychain — broadens the blast radius of a compromised unlock and
    // contradicts the principle of session-bound credentials. The auth
    // token already provides "stay signed in" without this risk.
    if (creds) {
      await secureStorage.set('remembered_credentials', JSON.stringify({ identifier: creds.identifier }));
    } else {
      await secureStorage.remove('remembered_credentials');
    }
    set({ rememberedCredentials: creds });
  },

  logout: async () => {
    await secureStorage.remove('auth_token');
    await AsyncStorage.removeItem('@runner_onboarding_skipped');
    // Privacy: don't leak the previous user's recent destinations,
    // cached profile/wallet data, or in-memory request responses to
    // whoever signs in next on the same device.
    await Promise.allSettled([
      geocodingService.clearRecent(),
      CacheService.clearAll(),
    ]);
    apiCache.clear();
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
    let rememberedCredentials: { identifier: string } | null = null;
    if (rememberedRaw) {
      try {
        const parsed = JSON.parse(rememberedRaw);
        // Backwards compat: silently drop any legacy stored password.
        if (parsed?.identifier) {
          rememberedCredentials = { identifier: String(parsed.identifier) };
        }
      } catch {}
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
