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

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    return getStore().getItemAsync(key);
  },

  async set(key: string, value: string): Promise<void> {
    await getStore().setItemAsync(key, value);
  },

  async remove(key: string): Promise<void> {
    await getStore().deleteItemAsync(key);
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
