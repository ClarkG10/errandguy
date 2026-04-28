import api from './api';
import { invalidateQuery } from '../hooks/useQuery';
import type { Coordinate } from '../types';

const invalidateRunnerProfile = () => invalidateQuery(['runner', 'profile']);
const invalidateRunnerErrands = () => {
  invalidateQuery(['runner', 'errand']);
  invalidateQuery(['runner', 'errands']);
  invalidateQuery(['bookings']);
};
const invalidateEarnings = () => invalidateQuery(['runner', 'earnings']);

export const runnerService = {
  getRunnerProfile() {
    return api.get('/runner/profile', { cacheTtlMs: 30_000 } as any);
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
    const p = api.put('/runner/profile', data);
    p.then(invalidateRunnerProfile).catch(() => {});
    return p;
  },

  uploadDocument(data: FormData) {
    const p = api.post('/runner/documents', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    p.then(invalidateRunnerProfile).catch(() => {});
    return p;
  },

  toggleOnline(status: boolean, coords?: { lat: number; lng: number }) {
    const p = api.put('/runner/online', { is_online: status, ...coords });
    p.then(invalidateRunnerProfile).catch(() => {});
    return p;
  },

  updateLocation(coords: Coordinate & { heading?: number; speed?: number }) {
    return api.post('/runner/location', coords);
  },

  getCurrentErrand() {
    return api.get('/runner/errand/current', { cacheTtlMs: 5_000 } as any);
  },

  acceptErrand(id: string) {
    const p = api.post(`/runner/errand/${id}/accept`);
    p.then(invalidateRunnerErrands).catch(() => {});
    return p;
  },

  declineErrand(id: string) {
    const p = api.post(`/runner/errand/${id}/decline`);
    p.then(invalidateRunnerErrands).catch(() => {});
    return p;
  },

  getAvailableErrands() {
    return api.get('/runner/errand/available', { cacheTtlMs: 5_000 } as any);
  },

  updateErrandStatus(id: string, status: string) {
    const p = api.post(`/runner/errand/${id}/status`, { status });
    p.then(invalidateRunnerErrands).catch(() => {});
    return p;
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
    return api.get('/runner/earnings', { params: { period }, cacheTtlMs: 15_000 } as any);
  },

  getEarningsHistory(params?: { page?: number; per_page?: number }) {
    return api.get('/runner/earnings/history', { params, cacheTtlMs: 10_000 } as any);
  },

  getErrandHistory(params?: {
    page?: number;
    per_page?: number;
    status?: string;
  }) {
    return api.get('/runner/errands/history', { params, cacheTtlMs: 10_000 } as any);
  },

  requestPayout(amount: number) {
    const p = api.post('/runner/payout/request', { amount });
    p.then(() => {
      invalidateEarnings();
      invalidateQuery(['wallet']);
    }).catch(() => {});
    return p;
  },

  triggerSOS(bookingId: string) {
    return api.post(`/runner/errand/${bookingId}/sos`);
  },

  deactivateSOS(bookingId: string) {
    return api.delete(`/runner/errand/${bookingId}/sos`);
  },
};
