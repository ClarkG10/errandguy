import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },

  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },

  async remove(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
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
