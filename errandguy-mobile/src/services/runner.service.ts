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
    ewallet_number?: string;
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
    // Silent: GPS push fires every ~5s while the runner is online; it
    // has zero user-facing intent and shouldn't pin the global progress
    // bar.
    return api.post('/runner/location', coords, { silent: true } as any);
  },

  getCurrentErrand() {
    return api.get('/runner/errand/current', { cacheTtlMs: 5_000 } as any);
  },

  /**
   * Fetch a single errand by id (any status). Used by deep links from
   * notifications so we can hydrate the runner errand screen even when
   * the runner store is empty (cold start, app killed mid-shift).
   */
  getErrand(id: string) {
    return api.get(`/runner/errand/${id}`, { cacheTtlMs: 4_000 } as any);
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
   * Status transition with optional photo uploads. Used for the
   * picked_up / delivered / completed transitions where the backend
   * requires (resp.) pickup_photo / delivery_photo / signature on the
   * SAME request as the status field — sending the status first and
   * then uploading the photo separately fails validation (422).
   *
   * If no photo is supplied this collapses to the cheap JSON variant
   * so transportation / queue / bills_payment runners don't pay the
   * multipart overhead.
   */
  advanceErrandStatus(
    id: string,
    status: string,
    opts?: {
      pickupPhoto?: string | null;
      deliveryPhoto?: string | null;
      signature?: string | null;
      note?: string | null;
      lat?: number | null;
      lng?: number | null;
    },
  ) {
    const hasFile = !!(opts?.pickupPhoto || opts?.deliveryPhoto || opts?.signature);
    let p;
    if (hasFile) {
      const form = new FormData();
      form.append('status', status);
      if (opts?.note) form.append('note', opts.note);
      if (opts?.lat != null) form.append('lat', String(opts.lat));
      if (opts?.lng != null) form.append('lng', String(opts.lng));
      if (opts?.pickupPhoto) {
        form.append('pickup_photo', {
          uri: opts.pickupPhoto,
          type: 'image/jpeg',
          name: 'pickup.jpg',
        } as any);
      }
      if (opts?.deliveryPhoto) {
        form.append('delivery_photo', {
          uri: opts.deliveryPhoto,
          type: 'image/jpeg',
          name: 'delivery.jpg',
        } as any);
      }
      if (opts?.signature) {
        form.append('signature', {
          uri: opts.signature,
          type: 'image/jpeg',
          name: 'signature.jpg',
        } as any);
      }
      p = api.post(`/runner/errand/${id}/status`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } else {
      p = api.post(`/runner/errand/${id}/status`, { status });
    }
    p.then(invalidateRunnerErrands).catch(() => {});
    return p;
  },

  /**
   * Submit the 4-digit ride PIN for a transportation errand. The server
   * tracks attempts (max 3) and locks the runner out on repeated misses,
   * so callers should treat 422 responses as user-facing errors.
   */
  verifyRidePin(id: string, pin: string) {
    const p = api.post(`/runner/errand/${id}/verify-pin`, { pin });
    p.then(invalidateRunnerErrands).catch(() => {});
    return p;
  },

  /**
   * Runner-side review of the customer for a completed booking. Mirrors
   * the customer's POST /bookings/{id}/review but routed under /runner
   * so the role middleware passes; the controller infers reviewee from
   * the reviewer's role on the booking.
   */
  submitCustomerReview(bookingId: string, rating: number, comment?: string) {
    const p = api.post(`/runner/errand/${bookingId}/review`, {
      rating,
      comment: comment?.trim() ? comment.trim() : null,
    });
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

  getEarningsHistory(params?: { page?: number; per_page?: number; date_from?: string; date_to?: string }) {
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
      invalidateQuery(['runner', 'payouts']);
    }).catch(() => {});
    return p;
  },

  // Reuses the shared wallet/transactions endpoint (which already supports
  // `type` filtering) so we don't have to duplicate a payouts index on the
  // backend just to list past requests on the runner's Payouts screen.
  getPayoutHistory(params?: { page?: number; per_page?: number }) {
    return api.get('/wallet/transactions', {
      params: { ...params, type: 'payout' },
      cacheTtlMs: 10_000,
    } as any);
  },

  triggerSOS(bookingId: string) {
    return api.post(`/runner/errand/${bookingId}/sos`);
  },

  deactivateSOS(bookingId: string) {
    return api.delete(`/runner/errand/${bookingId}/sos`);
  },
};
