/**
 * Personalised errand-type ordering.
 *
 * The catalogue arrives from the API in one global order (`ErrandType::orderBy
 * ('sort_order')`), and Home shows only the first four tiles of it. A customer
 * whose regular service is 5th, 7th or 9th in that global order therefore never
 * sees their own tile — they tap "See all" and scroll, on every single booking,
 * forever.
 *
 * The screen already knows what this customer books: the recent-bookings window
 * it loads for the "Recent" rows (and for the "Frequently booked" chip). These
 * helpers turn that window into a per-customer ordering. No new request, no new
 * field — a pure permutation of the catalogue the screen already holds.
 *
 * THE RULE (deliberately conservative, so tiles stay predictable):
 *
 *   1. A type is PROMOTED only once this customer has booked it at least
 *      `MIN_BOOKINGS_TO_PROMOTE` times inside the loaded window. One booking is
 *      not a habit, and letting a single tap reshuffle Home is exactly the
 *      churn that breaks muscle memory.
 *   2. Promoted types sort by booking count, descending.
 *   3. Every tie — and every un-promoted type — keeps its INCOMING order, which
 *      is the catalogue's global sort_order. So a brand-new customer, or one
 *      with no repeated type, sees precisely today's layout.
 *
 * Stability across renders is the caller's job: `rankErrandTypesByUsage` is a
 * pure function of its inputs, so a changing booking window CAN change the
 * order. Home computes the ranking once per session and then replays it through
 * `applyErrandTypeOrder`, so the tiles never move under the user's thumb
 * mid-session (see `(customer)/(tabs)/index.tsx`).
 */

/** Bookings of one type needed before it outranks the catalogue order. */
export const MIN_BOOKINGS_TO_PROMOTE = 2;

interface Identified {
  id: string;
}

interface TypeUsage {
  errand_type_id?: string | null;
}

/**
 * How many times each errand type appears in the given booking window.
 * Every status counts — a cancelled or in-flight booking still expresses
 * "this is the service I come here for".
 */
export function countErrandTypeUsage(
  bookings: readonly TypeUsage[] | null | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const booking of bookings ?? []) {
    const id = booking?.errand_type_id;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Order a catalogue by this customer's own usage. Returns a NEW array holding
 * exactly the same members (nothing is dropped or added).
 */
export function rankErrandTypesByUsage<T extends Identified>(
  types: readonly T[] | null | undefined,
  bookings: readonly TypeUsage[] | null | undefined,
  minBookings: number = MIN_BOOKINGS_TO_PROMOTE,
): T[] {
  const list = (types ?? []).filter(Boolean);
  const counts = countErrandTypeUsage(bookings);

  // Decorate / sort / undecorate rather than leaning on Array#sort stability:
  // the index tiebreak makes "ties keep catalogue order" explicit and engine-
  // independent.
  return list
    .map((type, index) => {
      const count = counts.get(type.id) ?? 0;
      return {
        type,
        index,
        count: count >= minBookings ? count : 0,
      };
    })
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((entry) => entry.type);
}

/**
 * Replay a previously-computed order (a list of ids) over a catalogue.
 *
 * Ids that are no longer in the catalogue are ignored; catalogue members the
 * order has never seen (a newly-added errand type) keep their incoming
 * position relative to each other and land after the ordered ones. A null /
 * empty order is a no-op that returns the catalogue untouched — which is what
 * makes "cold cache falls back to sort_order" true by construction.
 */
export function applyErrandTypeOrder<T extends Identified>(
  types: readonly T[] | null | undefined,
  orderedIds: readonly string[] | null | undefined,
): T[] {
  const list = (types ?? []).filter(Boolean);
  if (!orderedIds || orderedIds.length === 0) return [...list];

  const rank = new Map<string, number>();
  orderedIds.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });

  return list
    .map((type, index) => ({
      type,
      index,
      rank: rank.get(type.id) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.type);
}
