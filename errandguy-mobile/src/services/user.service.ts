import api from './api';
import { invalidateQuery } from '../hooks/useQuery';
import type { SavedAddress, TrustedContact } from '../types';

const invalidateProfile = () => invalidateQuery(['user', 'profile']);
const invalidateAddresses = () => invalidateQuery(['user', 'addresses']);
const invalidateContacts = () => invalidateQuery(['user', 'contacts']);

export const userService = {
  getProfile() {
    // Profile is read on every screen mount and rarely changes \u2014 cache for 30s.
    // Mutations below explicitly invalidate the persisted query cache.
    return api.get('/user/profile', { cacheTtlMs: 30_000 } as any);
  },

  updateProfile(data: {
    full_name?: string;
    email?: string;
    phone?: string;
    avatar_url?: string;
    role?: string;
  }) {
    const p = api.put('/user/profile', data);
    p.then(invalidateProfile).catch(() => {});
    return p;
  },

  uploadAvatar(file: FormData) {
    const p = api.post('/user/avatar', file, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    p.then(invalidateProfile).catch(() => {});
    return p;
  },

  updateFCMToken(token: string) {
    return api.put('/user/fcm-token', { fcm_token: token });
  },

  deleteAccount() {
    return api.delete('/user/account');
  },

  getAddresses() {
    return api.get('/user/addresses', { cacheTtlMs: 60_000 } as any);
  },

  addAddress(data: Omit<SavedAddress, 'id' | 'user_id'>) {
    const p = api.post('/user/addresses', data);
    p.then(invalidateAddresses).catch(() => {});
    return p;
  },

  updateAddress(id: string, data: Partial<SavedAddress>) {
    const p = api.put(`/user/addresses/${id}`, data);
    p.then(invalidateAddresses).catch(() => {});
    return p;
  },

  deleteAddress(id: string) {
    const p = api.delete(`/user/addresses/${id}`);
    p.then(invalidateAddresses).catch(() => {});
    return p;
  },

  getTrustedContacts() {
    return api.get('/user/trusted-contacts', { cacheTtlMs: 60_000 } as any);
  },

  addTrustedContact(data: Omit<TrustedContact, 'id' | 'user_id'>) {
    const p = api.post('/user/trusted-contacts', data);
    p.then(invalidateContacts).catch(() => {});
    return p;
  },

  updateTrustedContact(
    id: string,
    data: Partial<Omit<TrustedContact, 'id' | 'user_id'>>,
  ) {
    const p = api.put(`/user/trusted-contacts/${id}`, data);
    p.then(invalidateContacts).catch(() => {});
    return p;
  },

  deleteTrustedContact(id: string) {
    const p = api.delete(`/user/trusted-contacts/${id}`);
    p.then(invalidateContacts).catch(() => {});
    return p;
  },
};
