import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBookingStore } from '../stores/bookingStore';
import { usePaymentStore } from '../stores/paymentStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { CacheService } from '../services/cache.service';
import { geocodingService } from '../services/geocoding.service';
import { apiCache } from '../services/api';
import { clearRecentRecipients } from './recentRecipients';
import { clearMutationQueue } from '../services/mutationQueue';

/** Unsent support-ticket text. Written only by the support compose screen,
 *  which keeps the key local to itself — mirrored here because the draft is
 *  the user's own words about their own problem and must not outlive them. */
const SUPPORT_DRAFT_KEY = '@support_draft_v1';

/** The trusted-contacts list (names + mobile numbers of the people a customer
 *  nominates for emergencies). Unlike every other key here it carries NO user
 *  id, so it isn't merely stale for the next account — it is directly readable
 *  by them. Written by the trusted-contacts screen and the auth warm-up, both
 *  of which keep their own copy of the literal. */
const TRUSTED_CONTACTS_KEY = '@trusted_contacts_cache';

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
 *   • trusted contacts (@trusted_contacts_cache) — emergency contacts' names
 *     and numbers, under a key with no user id in it.
 *   • the offline mutation queue (@mutation_queue_v1) — the previous account's
 *     UNSENT writes. This is the one entry that is not merely stale but
 *     actively destructive: the queue flushes on the next reconnect/boot with
 *     whatever bearer token is then resident, so on a shared handset (common
 *     here) user A's queued profile edit or new address would be replayed
 *     under user B's session — overwriting B's name, filing A's address in B's
 *     address book. clearMutationQueue() existed with no callers.
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
    AsyncStorage.removeItem(TRUSTED_CONTACTS_KEY),
    clearMutationQueue(),
  ]);
  apiCache.clear();
}
