import api from './api';
import { invalidateQuery } from '../hooks/useQuery';

const invalidateBookingsCaches = (id?: string) => {
  // Fire-and-forget — cache wipes shouldn't block the UI.
  invalidateQuery(['bookings']);
  invalidateQuery(['booking', 'active']);
  if (id) invalidateQuery(['booking', id]);
};

export const bookingService = {
  getBookings(params?: { status?: string; page?: number; per_page?: number }) {
    // Listing screens often re-mount during navigation — a 5s window
    // collapses repeated identical paginated requests into one call.
    return api.get('/bookings', { params, cacheTtlMs: 5000 } as any);
  },

  createBooking(data: {
    errand_type_id: string;
    pickup_address: string;
    pickup_lat: number;
    pickup_lng: number;
    pickup_contact_name?: string;
    pickup_contact_phone?: string;
    dropoff_address?: string;
    dropoff_lat?: number;
    dropoff_lng?: number;
    dropoff_contact_name?: string;
    dropoff_contact_phone?: string;
    description?: string;
    special_instructions?: string;
    estimated_item_value?: number;
    shopping_budget?: number;
    pricing_mode: 'fixed' | 'negotiate';
    vehicle_type_rate?: string;
    customer_offer?: number;
    schedule_type: 'now' | 'scheduled';
    scheduled_at?: string;
    payment_method?: string;
    payment_method_id?: string;
    promo_code?: string;
    items?: Array<{ name: string; quantity: number; estimated_price?: number }>;
  }) {
    const p = api.post('/bookings', data);
    p.then(() => invalidateBookingsCaches()).catch(() => {});
    return p;
  },

  getBooking(id: string) {
    return api.get(`/bookings/${id}`, { cacheTtlMs: 4000 } as any);
  },

  cancelBooking(id: string, reason?: string) {
    const p = api.post(`/bookings/${id}/cancel`, { reason });
    p.then(() => invalidateBookingsCaches(id)).catch(() => {});
    return p;
  },

  cancelPreview(id: string) {
    return api.get<{
      data: {
        fee: number;
        tier: 'free' | 'flat' | 'percentage';
        reason: string;
        cancellable: boolean;
      };
    }>(`/bookings/${id}/cancel-preview`);
  },

  trackBooking(id: string) {
    return api.get(`/bookings/${id}/track`, { cacheTtlMs: 4000 } as any);
  },

  reviewBooking(id: string, data: { rating: number; comment?: string }) {
    const p = api.post(`/bookings/${id}/review`, data);
    p.then(() => invalidateBookingsCaches(id)).catch(() => {});
    return p;
  },

  getActiveBooking() {
    return api.get('/bookings/active', { cacheTtlMs: 5000 } as any);
  },

  getEstimate(data: {
    errand_type_id: string;
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat?: number;
    dropoff_lng?: number;
  }) {
    return api.post('/bookings/estimate', data);
  },

  rebookErrand(id: string) {
    const p = api.post(`/bookings/${id}/rebook`);
    p.then(() => invalidateBookingsCaches()).catch(() => {});
    return p;
  },

  verifyPin(id: string, pin: string) {
    return api.post(`/runner/errand/${id}/verify-pin`, { pin });
  },

  shareTrip(id: string) {
    return api.post(`/bookings/${id}/share-trip`);
  },

  revokeTrip(id: string) {
    return api.delete(`/bookings/${id}/share-trip`);
  },

  triggerSOS(id: string) {
    return api.post(`/bookings/${id}/sos`);
  },

  deactivateSOS(id: string) {
    return api.delete(`/bookings/${id}/sos`);
  },
};
