import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBookingStore } from '../stores/bookingStore';
import { usePaymentStore } from '../stores/paymentStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { CacheService } from '../services/cache.service';
import { geocodingService } from '../services/geocoding.service';
import { apiCache } from '../services/api';
import { clearRecentRecipients } from './recentRecipients';

/** Unsent support-ticket text. Written only by the support compose screen,
 *  which keeps the key local to itself — mirrored here because the draft is
 *  the user's own words about their own problem and must not outlive them. */
const SUPPORT_DRAFT_KEY = '@support_draft_v1';

/**
 * Wipe everything scoped to the currently signed-in account so it can't bleed
 * into the next user on the same device. Called on logout AND when a DIFFERENT
 * account signs in while the previous user's data is still resident (see
 * authStore.setUser → reconcileAccount).
 *
 * Covers what survives a sign-out/sign-in on the same device — both the state
 * that is NOT keyed by user id (the next user reads it directly) and the state
 * that IS keyed but would otherwise sit on disk forever:
 *   • bookingStore.activeBooking — in-memory only, so it lingers when a second
 *     account logs in without an app restart (the "undefined · step …" / wrong
 *     errand ghost card on Home).
 *   • bookingStore draft (@booking_draft_v1) — persisted across launches.
 *   • paymentStore attempt (@payment_attempt_v1) — a persisted in-flight money
 *     attempt must never carry across accounts.
 *   • preferencesStore payment memory (@last_payment_method_v1) — how the
 *     PREVIOUS account last chose to pay. Only the account-scoped map goes;
 *     the device-comfort appearance prefs stay.
 *   • recent recipients (@errandguy:recent_recipients:*) — third-party names
 *     and mobile numbers, the most sensitive thing this app keeps on-device.
 *   • support compose draft (@support_draft_v1).
 *   • CacheService (persisted query cache) + apiCache (in-memory) + recent
 *     destinations — cached network responses / addresses of the prior user.
 */
export async function clearAccountScopedState(): Promise<void> {
  // Synchronous in-memory / persisted zustand resets first.
  useBookingStore.getState().setActiveBooking(null);
  useBookingStore.getState().clearDraft();
  usePaymentStore.getState().resolve();
  usePreferencesStore.getState().clearLastPaymentMethods();

  // Cached network data + on-device PII (best-effort, never throws — a storage
  // failure must not be able to strand someone in a half-signed-out session).
  await Promise.allSettled([
    CacheService.clearAll(),
    geocodingService.clearRecent(),
    clearRecentRecipients(),
    AsyncStorage.removeItem(SUPPORT_DRAFT_KEY),
  ]);
  apiCache.clear();
}
