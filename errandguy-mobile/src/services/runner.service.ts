import api from './api';
import type { Coordinate } from '../types';

export const runnerService = {
  getRunnerProfile() {
    return api.get('/runner/profile');
  },

  updateRunnerProfile(data: {
    vehicle_type?: string;
    preferred_types?: string[];
    working_area?: string;
    bank_name?: string;
    bank_account_number?: string;
    bank_account_name?: string;
  }) {
    return api.put('/runner/profile', data);
  },

  uploadDocument(data: FormData) {
    return api.post('/runner/documents', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  toggleOnline(status: boolean, coords?: { lat: number; lng: number }) {
    return api.put('/runner/online', { is_online: status, ...coords });
  },

  updateLocation(coords: Coordinate & { heading?: number; speed?: number }) {
    return api.post('/runner/location', coords);
  },

  getCurrentErrand() {
    return api.get('/runner/errand/current');
  },

  acceptErrand(id: string) {
    return api.post(`/runner/errand/${id}/accept`);
  },

  declineErrand(id: string) {
    return api.post(`/runner/errand/${id}/decline`);
  },

  getAvailableErrands() {
    return api.get('/runner/errand/available');
  },

  updateErrandStatus(id: string, status: string) {
    return api.post(`/runner/errand/${id}/status`, { status });
  },

  getEarnings(period?: 'today' | 'week' | 'month') {
    return api.get('/runner/earnings', { params: { period } });
  },

  getEarningsHistory(params?: { page?: number; per_page?: number }) {
    return api.get('/runner/earnings/history', { params });
  },

  getErrandHistory(params?: {
    page?: number;
    per_page?: number;
    status?: string;
  }) {
    return api.get('/runner/errands/history', { params });
  },

  requestPayout(amount: number) {
    return api.post('/runner/payout/request', { amount });
  },
};
