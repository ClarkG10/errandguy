import api from './api';

export const authService = {
  register(data: {
    phone?: string;
    email?: string;
    password: string;
    full_name: string;
    role: 'customer' | 'runner';
  }) {
    return api.post('/auth/register', data);
  },

  login(data: { phone?: string; email?: string; password: string }) {
    return api.post('/auth/login', data);
  },

  sendOTP(data: { phone?: string; email?: string }) {
    return api.post('/auth/send-otp', data);
  },

  verifyOTP(data: { phone?: string; email?: string; code: string }) {
    return api.post('/auth/verify-otp', data);
  },

  socialLogin(provider: string, token: string) {
    return api.post('/auth/social-login', { provider, token });
  },

  logout() {
    return api.post('/auth/logout');
  },

  forgotPassword(email: string) {
    return api.post('/auth/forgot-password', { email });
  },

  resetPassword(data: {
    token: string;
    email: string;
    password: string;
    password_confirmation: string;
  }) {
    return api.post('/auth/reset-password', data);
  },
};
