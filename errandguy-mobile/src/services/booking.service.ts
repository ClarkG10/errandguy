import api from './api';

export const bookingService = {
  getBookings(params?: { status?: string; page?: number; per_page?: number }) {
    return api.get('/bookings', { params });
  },

  createBooking(data: {
    errand_type_id: string;
    pickup_address: string;
    pickup_lat: number;
    pickup_lng: number;
    dropoff_address?: string;
    dropoff_lat?: number;
    dropoff_lng?: number;
    instructions?: string;
    pricing_mode: 'fixed' | 'negotiate';
    schedule_type: 'now' | 'scheduled';
    scheduled_at?: string;
    offered_price?: number;
    payment_method_id?: string;
    items?: Array<{ name: string; quantity: number; estimated_price?: number }>;
  }) {
    return api.post('/bookings', data);
  },

  getBooking(id: string) {
    return api.get(`/bookings/${id}`);
  },

  cancelBooking(id: string, reason?: string) {
    return api.post(`/bookings/${id}/cancel`, { reason });
  },

  trackBooking(id: string) {
    return api.get(`/bookings/${id}/track`);
  },

  reviewBooking(id: string, data: { rating: number; comment?: string }) {
    return api.post(`/bookings/${id}/review`, data);
  },

  getActiveBooking() {
    return api.get('/bookings/active');
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
    return api.post(`/bookings/${id}/rebook`);
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
