import api from './api';
import type { AxiosRequestConfig } from 'axios';
import { invalidateQuery } from '../hooks/useQuery';
import type { Promo } from './config.service';
import type { Booking, ErrandType, SavedAddress, TrustedContact } from '../types';

/** Shape of GET /user/referral → `data` (ReferralController::show). */
export interface ReferralInfo {
  referral_code: string;
  share_link: string;
  counts: {
    pending: number;
    qualified: number;
    rewarded: number;
  };
  total_earned: number;
}

/**
 * Shape of GET /customer/home → `data` (Customer\HomeController::show).
 *
 * The customer Home dashboard in ONE authenticated round trip. Each section is
 * produced server-side by invoking the very controller method that serves the
 * individual route and unwrapping its `data` key, so every section is
 * byte-identical to what the endpoint it stands in for returns today:
 *
 *   errand_types    ← GET /errand-types          (shares the same SWR entry)
 *   active_booking  ← GET /bookings/active
 *   recent_bookings ← GET /bookings?per_page=5   (the data ARRAY, no paginator meta)
 *   wallet_balance  ← GET /wallet/balance → data.balance
 *   promos          ← GET /promos
 *   referral        ← GET /user/referral
 *
 * That parity is the whole point: `preload.service` seeds the existing
 * per-section useQuery cache keys straight from this payload, so any drift
 * would silently poison them. The individual endpoints stay as each screen's
 * revalidation path.
 */
export interface CustomerHomeAggregate {
  errand_types: ErrandType[];
  active_booking: Booking | null;
  /**
   * ALL live errands, alongside the singular above (Home shows up to three).
   *
   * Optional because an older API build omits it — and the client must not
   * assume otherwise: a missing array has to leave the list cache a MISS so
   * the screen fetches normally, never seed an empty one over a live errand.
   */
  active_bookings?: Booking[];
  recent_bookings: Booking[];
  /**
   * The bare NUMBER, not the `{ balance }` object — the app's
   * ['wallet','balance',userId] cache key holds a plain number, and seeding
   * the object there once rendered "₱[object Object]" on cold start.
   */
  wallet_balance: number;
  promos: Promo[];
  referral: ReferralInfo | null;
}

const invalidateProfile = () => invalidateQuery(['user', 'profile']);
const invalidateAddresses = () => invalidateQuery(['user', 'addresses']);
const invalidateContacts = () => invalidateQuery(['user', 'contacts']);
const invalidateReferral = () => invalidateQuery(['user', 'referral']);

export const userService = {
  getProfile(config?: AxiosRequestConfig) {
    // Profile is read on every screen mount and rarely changes — cache for 30s.
    // Mutations below explicitly invalidate the persisted query cache.
    // Callers may pass an AbortSignal via `config.signal` (e.g. the
    // session-validation effect on the root layout) to cancel pending
    // requests on unmount.
    return api.get('/user/profile', { cacheTtlMs: 30_000, ...(config ?? {}) });
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

  uploadAvatar(file: FormData, onProgress?: (frac: number) => void) {
    const p = api.post('/user/avatar', file, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // 0–1 upload fraction for <UploadProgress>. Only emit when the total
      // is known; onUploadProgress rides straight through the api wrapper
      // (non-GETs are passed to axios untouched).
      onUploadProgress: onProgress
        ? (e: any) => {
            if (e.total) onProgress(e.loaded / e.total);
          }
        : undefined,
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
    return api.get('/user/addresses', { cacheTtlMs: 60_000, silent: true });
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
    return api.get('/user/trusted-contacts', { cacheTtlMs: 60_000, silent: true });
  },

  addTrustedContact(data: Omit<TrustedContact, 'id' | 'user_id' | 'created_at' | 'updated_at'>) {
    const p = api.post('/user/trusted-contacts', data);
    p.then(invalidateContacts).catch(() => {});
    return p;
  },

  updateTrustedContact(
    id: string,
    data: Partial<Omit<TrustedContact, 'id' | 'user_id' | 'created_at' | 'updated_at'>>,
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

  // ── Home aggregate ────────────────────────────────────────────────
  // GET /customer/home — all six above-the-fold Home sections in one
  // authenticated round trip instead of six (see CustomerHomeAggregate).
  // Takes no parameters; the server ignores/strips any that are sent.
  // Silent so the cold-start warm-up never flashes the top progress bar,
  // and micro-cached briefly so a warm-up + an in-race screen fetch
  // coalesce rather than paying the round trip twice.
  getCustomerHome() {
    return api.get('/customer/home', { cacheTtlMs: 30_000, silent: true });
  },

  // ── Referral program ──────────────────────────────────────────────
  // GET /user/referral returns the caller's own code, a shareable link,
  // per-status counts of people they've referred, and total bonus earned.
  getReferral() {
    return api.get('/user/referral', { cacheTtlMs: 30_000, silent: true });
  },

  // POST /user/referral/apply — redeem someone else's code. Resolves 201
  // on success; rejects with a 422 { message } on invalid / self / already
  // referred (the caller surfaces `error.message`).
  applyReferral(code: string) {
    const p = api.post('/user/referral/apply', { code });
    p.then(invalidateReferral).catch(() => {});
    return p;
  },
};
