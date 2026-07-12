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
    // Silent: lists are revalidated in the background by useQuery and
    // by pull-to-refresh; the latter has its own RefreshControl
    // spinner, so the global API activity bar would just be noise.
    return api.get('/bookings', { params, cacheTtlMs: 5000, silent: true } as any);
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
    // Structured shopping checklist (name + qty). Sent alongside the
    // human-readable `description` serialization so the runner's synced
    // checklist is authoritative. Mirrors CreateBookingRequest's
    // `shopping_items.*.{name,qty}` rules.
    shopping_items?: Array<{ name: string; qty?: number }>;
  }) {
    const p = api.post('/bookings', data);
    p.then(() => invalidateBookingsCaches()).catch(() => {});
    return p;
  },

  getBooking(id: string) {
    // Silent: the tracking screen revalidates this every few seconds
    // (and the booking detail sheet too); leaving it un-silenced kept
    // the global progress bar permanently visible during a live
    // errand. The user-perceived loading state is conveyed by the
    // tracking UI's own status pills, not by a top-of-screen blip.
    return api.get(`/bookings/${id}`, { cacheTtlMs: 4000, silent: true } as any);
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
    return api.get(`/bookings/${id}/track`, { cacheTtlMs: 4000, silent: true } as any);
  },

  reviewBooking(id: string, data: { rating: number; comment?: string }) {
    const p = api.post(`/bookings/${id}/review`, data);
    p.then(() => invalidateBookingsCaches(id)).catch(() => {});
    return p;
  },

  getActiveBooking() {
    // Silent: customer Home polls this on focus/foreground; the user
    // didn't explicitly ask for it.
    return api.get('/bookings/active', { cacheTtlMs: 5000, silent: true } as any);
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

  /**
   * Re-attempt matching after a `no_runner` outcome. `widenStep` 1–3
   * progressively expands the search radius server-side.
   */
  retryMatch(id: string, widenStep: 1 | 2 | 3 = 1) {
    const p = api.post<{
      data: any;
      meta: { radius_km: number; widen_step: number };
      message: string;
    }>(`/bookings/${id}/retry-match`, { widen_step: widenStep });
    p.then(() => invalidateBookingsCaches(id)).catch(() => {});
    return p;
  },

  verifyPin(id: string, pin: string) {
    return api.post(`/runner/errand/${id}/verify-pin`, { pin });
  },

  // Returns a public read-only trip link + its token. The link is
  // GET {app.url}/trip/{token} — safe to hand to a trusted contact.
  shareTrip(id: string) {
    return api.post<{ data: { link: string; token: string } }>(
      `/bookings/${id}/share-trip`,
    );
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
