import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { User, UserRole } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: UserRole | null;

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

  setUser: (user) =>
    set({
      user,
      role: user?.role ?? null,
      isAuthenticated: !!user,
    }),

  setToken: async (token) => {
    if (token) {
      await SecureStore.setItemAsync('auth_token', token);
    } else {
      await SecureStore.deleteItemAsync('auth_token');
    }
    set({ token });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('auth_token');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      role: null,
    });
  },

  loadFromStorage: async () => {
    set({ isLoading: true });
    const token = await SecureStore.getItemAsync('auth_token');
    set({
      token,
      isAuthenticated: !!token,
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
