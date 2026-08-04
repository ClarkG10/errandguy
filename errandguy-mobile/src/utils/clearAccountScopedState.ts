import { useBookingStore } from '../stores/bookingStore';
import { usePaymentStore } from '../stores/paymentStore';
import { CacheService } from '../services/cache.service';
import { geocodingService } from '../services/geocoding.service';
import { apiCache } from '../services/api';

/**
 * Wipe everything scoped to the currently signed-in account so it can't bleed
 * into the next user on the same device. Called on logout AND when a DIFFERENT
 * account signs in while the previous user's data is still resident (see
 * authStore.setUser → reconcileAccount).
 *
 * Covers the leak paths that are NOT keyed by user id and therefore survive a
 * sign-out/sign-in on the same device:
 *   • bookingStore.activeBooking — in-memory only, so it lingers when a second
 *     account logs in without an app restart (the "undefined · step …" / wrong
 *     errand ghost card on Home).
 *   • bookingStore draft (@booking_draft_v1) — persisted across launches.
 *   • paymentStore attempt (@payment_attempt_v1) — a persisted in-flight money
 *     attempt must never carry across accounts.
 *   • CacheService (persisted query cache) + apiCache (in-memory) + recent
 *     destinations — cached network responses / addresses of the prior user.
 */
export async function clearAccountScopedState(): Promise<void> {
  // Synchronous in-memory / persisted zustand resets first.
  useBookingStore.getState().setActiveBooking(null);
  useBookingStore.getState().clearDraft();
  usePaymentStore.getState().resolve();

  // Cached network data + recent addresses (best-effort, never throws).
  await Promise.allSettled([
    CacheService.clearAll(),
    geocodingService.clearRecent(),
  ]);
  apiCache.clear();
}
