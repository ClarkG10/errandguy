import api from './api';
import { invalidateQuery } from '../hooks/useQuery';

const invalidateBookingsCaches = (id?: string) => {
  // Fire-and-forget — cache wipes shouldn't block the UI.
  invalidateQuery(['bookings']);
  invalidateQuery(['booking', 'active']);
  if (id) invalidateQuery(['booking', id]);
};

// ── Fare-estimate prefetch cache (P1) ──────────────────────────────────────
// POST /bookings/estimate is the sole gate on the Review screen's Confirm CTA,
// but it's a POST, so the api-layer GET dedupe/micro-cache never warms it. We
// stash the last estimate keyed by a coord+type signature so Review can paint
// the fare instantly when it was already computed at the details phase-flip —
// and so a prefetch + Review double-POST (POSTs aren't deduped) collapses to one.
export interface EstimateInput {
  errand_type_id: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  /** Multi-stop extra destinations — only coords are needed for a quote. */
  stops?: Array<{ lat: number; lng: number }> | null;
}
// Short freshness window: a long-idle draft must NOT confirm on a stale fare —
// past this, Review refetches. The normal type→details→schedule→review flow is
// a few seconds, well inside this.
const ESTIMATE_FRESH_MS = 120_000;
const qz = (n: number | null | undefined) => (n == null ? 'x' : Number(n).toFixed(5));
// All four coords + every stop coord go into the signature (dropoff is
// null/absent for single-location errands, which qz maps to 'x'). Stops change
// the fare, so they MUST be part of the cache key or a stale quote would show.
const estimateSignature = (d: EstimateInput) => {
  const stops = (d.stops ?? []).map((s) => `${qz(s.lat)},${qz(s.lng)}`).join(';');
  return `${d.errand_type_id}|${qz(d.pickup_lat)},${qz(d.pickup_lng)}|${qz(d.dropoff_lat)},${qz(d.dropoff_lng)}|${stops}`;
};
let estimateStash: { signature: string; result: any; fetchedAt: number } | null = null;
const estimateInflight = new Map<string, Promise<any>>();

// Fire the estimate POST at most once per in-flight signature (collapses an
// overlapping prefetch + Review fetch) and stash the unwrapped result.
function runEstimate(input: EstimateInput): Promise<any> {
  const signature = estimateSignature(input);
  const pending = estimateInflight.get(signature);
  if (pending) return pending;
  const p = api
    .post('/bookings/estimate', {
      errand_type_id: input.errand_type_id,
      pickup_lat: input.pickup_lat,
      pickup_lng: input.pickup_lng,
      dropoff_lat: input.dropoff_lat ?? undefined,
      dropoff_lng: input.dropoff_lng ?? undefined,
      stops: input.stops && input.stops.length
        ? input.stops.map((s) => ({ lat: s.lat, lng: s.lng }))
        : undefined,
    })
    .then((res: any) => {
      const result = res.data?.data ?? null;
      estimateStash = { signature, result, fetchedAt: Date.now() };
      return result;
    })
    .finally(() => {
      estimateInflight.delete(signature);
    });
  estimateInflight.set(signature, p);
  return p;
}

export const bookingService = {
  getBookings(params?: { status?: string; page?: number; per_page?: number }) {
    // Listing screens often re-mount during navigation — a 5s window
    // collapses repeated identical paginated requests into one call.
    // Silent: lists are revalidated in the background by useQuery and
    // by pull-to-refresh; the latter has its own RefreshControl
    // spinner, so the global API activity bar would just be noise.
    return api.get('/bookings', { params, cacheTtlMs: 5000, silent: true });
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
    // Multi-stop extra destinations (after the primary dropoff). Priced +
    // persisted server-side; capped at 3 by CreateBookingRequest.
    stops?: Array<{
      address: string;
      lat: number;
      lng: number;
      contact_name?: string;
      contact_phone?: string;
      note?: string;
    }>;
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
  }, opts?: { idempotencyKey?: string }) {
    const p = api.post('/bookings', data, { idempotencyKey: opts?.idempotencyKey });
    p.then(() => invalidateBookingsCaches()).catch(() => {});
    return p;
  },

  getBooking(id: string) {
    // Silent: the tracking screen revalidates this every few seconds
    // (and the booking detail sheet too); leaving it un-silenced kept
    // the global progress bar permanently visible during a live
    // errand. The user-perceived loading state is conveyed by the
    // tracking UI's own status pills, not by a top-of-screen blip.
    return api.get(`/bookings/${id}`, { cacheTtlMs: 4000, silent: true });
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

  trackBooking(id: string, opts?: { onlyLocation?: boolean }) {
    // The live-tracking poll (every 5–20s) only needs the runner's position +
    // status — not the whole booking with its runner profile + status logs.
    // `only=location` returns that lean slice, and the server ETag-304s
    // unchanged ticks on top. Callers that need the full booking (status-log
    // refresh on a transition) omit the flag; that keeps a distinct cache key.
    return api.get(`/bookings/${id}/track`, {
      params: opts?.onlyLocation ? { only: 'location' } : undefined,
      cacheTtlMs: 4000,
      silent: true,
    });
  },

  reviewBooking(id: string, data: { rating: number; comment?: string }) {
    const p = api.post(`/bookings/${id}/review`, data);
    p.then(() => invalidateBookingsCaches(id)).catch(() => {});
    return p;
  },

  /** Tip the runner on a completed booking, funded instantly from the
   *  customer's wallet balance. Fails with INSUFFICIENT_WALLET_BALANCE when the
   *  balance can't cover it — callers fall back to {@link tipCheckout}. */
  tip(id: string, amount: number) {
    const p = api.post(`/bookings/${id}/tip`, { amount });
    p.then(() => invalidateBookingsCaches(id)).catch(() => {});
    return p;
  },

  /** Start a GATEWAY-funded tip (GCash / Maya / card) — the zero-wallet / COD
   *  path. Returns a `checkout_url` the app opens; the runner is credited only
   *  after Xendit confirms via webhook. `data.id` is the tip transaction id to
   *  poll for verification (via getTopUpStatus). */
  tipCheckout(id: string, amount: number, method: 'gcash' | 'maya' | 'card', opts?: { idempotencyKey?: string }) {
    const p = api.post(`/bookings/${id}/tip-checkout`, { amount, method }, {
      idempotencyKey: opts?.idempotencyKey,
    });
    p.then(() => invalidateBookingsCaches(id)).catch(() => {});
    return p;
  },

  getActiveBooking() {
    // Silent: customer Home polls this on focus/foreground; the user
    // didn't explicitly ask for it.
    return api.get('/bookings/active', { cacheTtlMs: 5000, silent: true });
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

  // P1: warm the fare estimate at the details phase-flip (all coords finalized),
  // so Review paints the fare on its first frame. Fire-and-forget — the result
  // lands in estimateStash keyed by signature.
  prefetchEstimate(input: EstimateInput) {
    if (!input.errand_type_id || input.pickup_lat == null || input.pickup_lng == null) return;
    void runEstimate(input).catch(() => {});
  },

  // P1: the warmed estimate if its signature matches AND it's still fresh, else
  // null (Review then fetches). Does NOT itself hit the network.
  getCachedEstimate(input: EstimateInput): any | null {
    if (!estimateStash) return null;
    if (estimateStash.signature !== estimateSignature(input)) return null;
    if (Date.now() - estimateStash.fetchedAt > ESTIMATE_FRESH_MS) return null;
    return estimateStash.result;
  },

  // P1: deduped estimate fetch (also caches) — used by Review on a cache miss so
  // it coalesces with any prefetch still in flight. Resolves to the unwrapped
  // estimate object (not the axios response).
  fetchEstimate(input: EstimateInput): Promise<any> {
    return runEstimate(input);
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
