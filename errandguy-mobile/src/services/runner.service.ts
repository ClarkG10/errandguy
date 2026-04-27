import api from './api';
import type { Coordinate } from '../types';

export const runnerService = {
  getRunnerProfile() {
    return api.get('/runner/profile');
  },

  updateRunnerProfile(data: {
    vehicle_type?: string;
    vehicle_plate?: string;
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

  /**
   * Picked-up update for shopping errands (food / grocery / purchase / bills_payment).
   * Sends actual_item_cost and a receipt photo as multipart/form-data so the backend
   * can reconcile against the customer's pre-authorized shopping_budget.
   */
  submitPickedUpWithReceipt(
    id: string,
    params: { actualCost: number; receiptUri: string },
  ) {
    const form = new FormData();
    form.append('status', 'picked_up');
    form.append('actual_item_cost', String(params.actualCost));
    form.append('receipt_photo', {
      uri: params.receiptUri,
      type: 'image/jpeg',
      name: 'receipt.jpg',
    } as any);
    return api.post(`/runner/errand/${id}/status`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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

  triggerSOS(bookingId: string) {
    return api.post(`/runner/errand/${bookingId}/sos`);
  },

  deactivateSOS(bookingId: string) {
    return api.delete(`/runner/errand/${bookingId}/sos`);
  },
};
