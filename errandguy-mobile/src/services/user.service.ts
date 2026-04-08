import api from './api';
import type { SavedAddress, TrustedContact } from '../types';

export const userService = {
  getProfile() {
    return api.get('/user/profile');
  },

  updateProfile(data: {
    full_name?: string;
    email?: string;
    avatar_url?: string;
  }) {
    return api.put('/user/profile', data);
  },

  uploadAvatar(file: FormData) {
    return api.post('/user/avatar', file, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  updateFCMToken(token: string) {
    return api.put('/user/fcm-token', { fcm_token: token });
  },

  deleteAccount() {
    return api.delete('/user/account');
  },

  getAddresses() {
    return api.get('/user/addresses');
  },

  addAddress(data: Omit<SavedAddress, 'id' | 'user_id'>) {
    return api.post('/user/addresses', data);
  },

  deleteAddress(id: string) {
    return api.delete(`/user/addresses/${id}`);
  },

  getTrustedContacts() {
    return api.get('/user/trusted-contacts');
  },

  addTrustedContact(data: Omit<TrustedContact, 'id' | 'user_id'>) {
    return api.post('/user/trusted-contacts', data);
  },

  updateTrustedContact(
    id: string,
    data: Partial<Omit<TrustedContact, 'id' | 'user_id'>>,
  ) {
    return api.put(`/user/trusted-contacts/${id}`, data);
  },

  deleteTrustedContact(id: string) {
    return api.delete(`/user/trusted-contacts/${id}`);
  },
};
