import api from './api';
import type { AxiosRequestConfig } from 'axios';
import { invalidateQuery } from '../hooks/useQuery';
import type {
  Booking,
  ErrandType,
  PayoutChannel,
  SavedAddress,
  TrustedContact,
} from '../types';

/**
 * Where to send the wallet balance when an account is deleted. Customers can
 * choose GCash or Maya; an account with a runner profile can also choose a bank
 * (then `bank_name` is required).
 */
export interface DeletionPayoutDestination {
  channel: PayoutChannel;
  account_number: string;
  account_name: string;
  bank_name?: string;
}

/** DELETE /user/account → `data`: the payout queued from the balance, if any. */
export interface AccountDeletionResult {
  payout: {
    id: string;
    amount: number;
    status: string;
    /** "GCash •••• 4567" — never more than the last four digits. */
    destination: string;
  } | null;
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
 *
 * That parity is the whole point: `preload.service` seeds the existing
 * per-section useQuery cache keys straight from this payload, so any drift
 * would silently poison them. The individual endpoints stay as each screen's
 * revalidation path.
 *
 * Until the app build from before the launch simplification is gone, the
 * server also sends empty `promos` and `referral` stubs (both features are
 * retired). They are deliberately left out of this type: nothing reads them,
 * and the payload guard in `preload.service` must accept the aggregate with or
 * without them.
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
}

const invalidateProfile = () => invalidateQuery(['user', 'profile']);
const invalidateAddresses = () => invalidateQuery(['user', 'addresses']);
const invalidateContacts = () => invalidateQuery(['user', 'contacts']);

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

  /**
   * Erase the account. With money in the wallet the server needs to know where
   * to send it: it answers 422 PAYOUT_METHOD_REQUIRED the first time, and the
   * call is repeated with `destination`. The balance is then queued as a
   * pending payout in the same step (see AccountDeletionResult).
   */
  deleteAccount(destination?: DeletionPayoutDestination) {
    return api.delete('/user/account', destination ? { data: destination } : undefined);
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
  // GET /customer/home — every above-the-fold Home section in one
  // authenticated round trip (see CustomerHomeAggregate).
  // Takes no parameters; the server ignores/strips any that are sent.
  // Silent so the cold-start warm-up never flashes the top progress bar,
  // and micro-cached briefly so a warm-up + an in-race screen fetch
  // coalesce rather than paying the round trip twice.
  getCustomerHome() {
    return api.get('/customer/home', { cacheTtlMs: 30_000, silent: true });
  },
};
