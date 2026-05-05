import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// SecureStore is native-only; on web we fall back to localStorage.
const isWeb = Platform.OS === 'web';

const webStorage = {
  async getItemAsync(key: string): Promise<string | null> {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    try { localStorage.setItem(key, value); } catch {}
  },
  async deleteItemAsync(key: string): Promise<void> {
    try { localStorage.removeItem(key); } catch {}
  },
};

function getStore() {
  if (isWeb) return webStorage;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-secure-store') as typeof webStorage;
}

// In-memory cache of every secure-storage key we've already read or
// written this session. SecureStore hits the native Keychain (iOS) /
// EncryptedSharedPreferences (Android), which costs 20–100 ms per
// call. The axios request interceptor reads `auth_token` on EVERY
// request, and screens that mount 3+ parallel queries used to pay
// that cost 3+ times sequentially. The token is already held in
// memory by the auth store and is invalidated explicitly on login /
// logout, so caching the value here is functionally identical and
// shaves the cold-mount perception time substantially.
const memCache = new Map<string, string | null>();

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (memCache.has(key)) return memCache.get(key) ?? null;
    const value = await getStore().getItemAsync(key);
    memCache.set(key, value);
    return value;
  },

  async set(key: string, value: string): Promise<void> {
    memCache.set(key, value);
    await getStore().setItemAsync(key, value);
  },

  async remove(key: string): Promise<void> {
    memCache.set(key, null);
    await getStore().deleteItemAsync(key);
  },

  /**
   * Synchronous read of the in-memory cache. Returns null on miss
   * (the caller should fall back to the async `get`). Used by the
   * axios request interceptor so the common-case auth-token fetch
   * stays off the JS bridge.
   */
  peek(key: string): string | null | undefined {
    return memCache.get(key);
  },
};

export const storage = {
  async get(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },

  async set(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  },

  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },

  async getJSON<T>(key: string): Promise<T | null> {
    const value = await AsyncStorage.getItem(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  },

  async setJSON<T>(key: string, value: T): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
};
