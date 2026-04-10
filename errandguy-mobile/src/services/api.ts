import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ── Request logging ──
api.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    if (__DEV__) {
      console.log(
        `📡 ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`,
        config.data ? JSON.stringify(config.data).slice(0, 200) : '',
      );
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response logging + error handling ──
api.interceptors.response.use(
  (response) => {
    if (__DEV__) {
      console.log(
        `✅ ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`,
      );
    }
    return response;
  },
  async (error) => {
    if (__DEV__) {
      if (error.response) {
        console.error(
          `❌ ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
          JSON.stringify(error.response.data).slice(0, 500),
        );
      } else {
        console.error(`❌ NETWORK ERROR ${error.config?.url}`, error.message);
      }
    }

    if (error.response) {
      const { status, data } = error.response;

      if (status === 401) {
        await SecureStore.deleteItemAsync('auth_token');
        // Auth store will handle redirect via listener
      }

      if (status === 422) {
        return Promise.reject({
          status: 422,
          message: data.message || 'Validation failed',
          errors: data.errors || {},
        });
      }

      if (status >= 500) {
        return Promise.reject({
          status,
          message: 'Something went wrong. Please try again later.',
          errors: {},
        });
      }

      return Promise.reject({
        status,
        message: data.message || 'An error occurred',
        errors: data.errors || {},
      });
    }

    return Promise.reject({
      status: 0,
      message: 'Network error. Please check your connection.',
      errors: {},
    });
  },
);

export default api;
