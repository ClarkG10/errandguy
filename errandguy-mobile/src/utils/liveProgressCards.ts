import type { AppNotification } from '../types';

/**
 * The runner's live progress on an errand — shopping-list ticks
 * (`shopping_items_updated`) and stop ticks (`booking_stops_updated`) — reaches
 * the customer as ONE coalesced inbox card per errand (NotificationService::
 * notifyInAppCoalesced). Each tick rewrites that card and re-broadcasts it with
 * the SAME id and fresh data.
 *
 * So the id alone can never say "this tick is new": the tracking screen used
 * to remember the last id it applied and ignore anything with that id, which
 * froze the checklist after the first tick. These helpers pick out the card
 * and fingerprint its CONTENT instead.
 */

/** The card of `type` for this booking (the inbox keeps at most one per errand). */
export function latestProgressCard(
  notifications: readonly AppNotification[],
  type: string,
  bookingId: string | null | undefined,
): AppNotification | null {
  if (!bookingId) return null;
  return (
    notifications.find(
      (n) => n?.data?.booking_id === bookingId && (n.data?.type ?? n.type) === type,
    ) ?? null
  );
}

/**
 * What a card SAYS, as a comparable string: a new tick always changes it (new
 * data, a bumped created_at), while the same card re-delivered or re-fetched
 * leaves it unchanged — so a tick is applied exactly once, however many times
 * it arrives.
 */
export function progressCardSignature(card: AppNotification | null | undefined): string | null {
  if (!card) return null;
  let data: string;
  try {
    data = JSON.stringify(card.data ?? null);
  } catch {
    data = '';
  }
  return `${card.id}|${card.created_at ?? ''}|${data}`;
}
