/**
 * Seeding the recipient chips from the SERVER's own history.
 *
 * `recentRecipients` is written only when a booking's contacts are confirmed
 * and read only from `@errandguy:recent_recipients:<userId>` — so a reinstall
 * (routine here) or a second handset comes back empty and the customer retypes
 * a name plus an 11-digit number for someone the platform already has on file.
 * The data was never lost: `pickup_contact_name/phone` and
 * `dropoff_contact_name/phone` ride on every past booking of theirs, and the
 * Home screen (and the booking-details screen itself) already load a
 * recent-bookings window under the `['bookings','recent',<userId>]` query key.
 *
 * Two sibling features — `bookingRecall` and `errandTypeOrder` — are already
 * built as pure functions over that same window and are therefore
 * reinstall-proof by construction. This is that pattern applied to the chips:
 * no new endpoint, no new field, no extra request. On a fresh install the
 * window is fetched from the server the moment Home paints, so by the time the
 * booking form asks for chips there is something to derive from.
 *
 * SCOPING (deliberate, this is third-party names and mobile numbers):
 *   - The window is read from the cache entry keyed by the SAME user id the
 *     chips themselves are keyed by, so a derivation can only ever produce that
 *     account's own contacts — the account-crossing hazard is structural, not a
 *     matter of remembering a check.
 *   - A missing / 'anon' id seeds nothing at all. The boot-snapshot
 *     (provisional) user carries the id the server confirmed on a previous
 *     launch, and `reconcileAccount` purges the resident cache when a different
 *     account signs in, so there is no window to derive from before the real
 *     profile lands.
 *   - Nothing here fetches. If the window isn't cached, the caller keeps
 *     today's behaviour (no chips).
 */

import { CacheService } from '../services/cache.service';

export interface HistoryRecipient {
  name: string;
  phone: string;
}

/** The only booking fields a derivation reads. */
export interface RecipientSource {
  created_at?: string | null;
  pickup_contact_name?: string | null;
  pickup_contact_phone?: string | null;
  dropoff_contact_name?: string | null;
  dropoff_contact_phone?: string | null;
}

/**
 * `useQuery` cache key for the recent-bookings window, mirrored from
 * `buildKey` in hooks/useQuery (`META_PREFIX` + the key parts joined by ':').
 * Kept as a single expression here so the coupling is visible in one place.
 */
function recentBookingsCacheKey(userId: string): string {
  return `q:bookings:recent:${userId}`;
}

/** The envelope `useQuery` stores inside a CacheService entry. */
interface QueryEntry<T> {
  value: T;
  fetchedAt: number;
}

/**
 * The recent-bookings window this device already holds for `userId`, or null
 * when there is none (fresh install before Home has painted, expired TTL,
 * offline first run). Never fetches.
 */
export async function readCachedRecentBookings(
  userId: string | null | undefined,
): Promise<RecipientSource[] | null> {
  if (!userId || userId === 'anon') return null;
  try {
    const entry = await CacheService.get<QueryEntry<RecipientSource[]>>(
      recentBookingsCacheKey(userId),
    );
    const list = entry?.value;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

/**
 * Newest-first recipients from a booking window.
 *
 * Mirrors the writer in the booking form exactly: BOTH the pickup and the
 * drop-off contact of each booking go into one flat pool (either side can be
 * the person you're sending to), a pair is only useful when it has a name AND a
 * number, and `normalize`/`identity` come from the caller so this stays a pure
 * function with no storage or phone-format knowledge of its own.
 *
 * Ordering is re-derived from `created_at` rather than trusted from the caller
 * (same reasoning as `bookingRecall`): a differently-sorted cache entry must
 * not put an older contact at the top. Pickup precedes drop-off within one
 * booking.
 */
export function deriveRecipientsFromBookings(
  bookings: readonly RecipientSource[] | null | undefined,
  options: {
    cap: number;
    normalize: (raw: string) => string;
    identity: (phone: string) => string;
  },
): HistoryRecipient[] {
  const { cap, normalize, identity } = options;
  if (cap <= 0) return [];

  const ordered = (bookings ?? [])
    .filter((b): b is RecipientSource => !!b)
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime(),
    );

  const out: HistoryRecipient[] = [];
  const seen = new Set<string>();

  for (const booking of ordered) {
    const pairs: Array<[string | null | undefined, string | null | undefined]> = [
      [booking.pickup_contact_name, booking.pickup_contact_phone],
      [booking.dropoff_contact_name, booking.dropoff_contact_phone],
    ];
    for (const [rawName, rawPhone] of pairs) {
      const name = (rawName ?? '').trim();
      const phone = normalize((rawPhone ?? '').trim());
      if (!name || !phone) continue;
      const key = identity(phone);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, phone });
      if (out.length >= cap) return out;
    }
  }

  return out;
}
