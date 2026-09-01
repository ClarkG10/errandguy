/**
 * Maps an incoming realtime notification onto the `useQuery` cache keys it
 * invalidates.
 *
 * WHY: a notification already tells the device exactly which entity changed —
 * "Support replied", "Verification Approved!", "Runner accepted your errand".
 * Before this, the app-wide handler only appended the row to the alerts inbox,
 * so the screen the notification DESCRIBED kept rendering its 15–60s-stale
 * snapshot until the user pull-to-refreshed or re-navigated. Turning the
 * notification into an `invalidateQuery` prefix makes the poll the fallback
 * instead of the primary path.
 *
 * Deliberately a pure function so the mapping is unit-testable without a
 * Reverb socket, a store, or AsyncStorage. The caller applies the keys through
 * the EXISTING invalidation bus (`invalidateQuery` in hooks/useQuery.ts) —
 * nothing here fetches or mutates.
 *
 * Types not listed below return `[]`, i.e. exactly today's behaviour: the row
 * lands in the inbox and nothing else happens.
 */

/** A query key in the shape `invalidateQuery()` accepts (a key PREFIX). */
export type InvalidationKey = (string | number)[];

export interface NotificationSignal {
  /** `NotificationResource.type` — mirrors `data.type` server-side. */
  type?: string | null;
  /** The notification's data bag, e.g. `{ type, booking_id, ticket_id }`. */
  data?: Record<string, unknown> | null;
}

/** Accept both string and numeric ids off the wire; reject anything else. */
function asId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function notificationInvalidationKeys(
  signal: NotificationSignal | null | undefined,
): InvalidationKey[] {
  if (!signal) return [];
  const data = signal.data ?? {};
  // Prefer the top-level column; fall back to the data bag (the two are the
  // same value — NotificationService writes `type` FROM `data['type']`).
  const type =
    typeof signal.type === 'string' && signal.type !== ''
      ? signal.type
      : typeof data.type === 'string'
        ? data.type
        : null;
  if (!type) return [];

  switch (type) {
    // Status moved on an errand: the customer home card's active-booking query
    // and every booking list that shows it.
    case 'booking_update': {
      const keys: InvalidationKey[] = [
        ['booking', 'active'],
        ['bookings'],
      ];
      const bookingId = asId(data.booking_id);
      if (bookingId) keys.push(['booking', bookingId]);
      return keys;
    }

    // Admin answered / re-statused a support ticket (SupportTicketNotifier).
    case 'support_reply':
    case 'support_status': {
      const keys: InvalidationKey[] = [['support', 'tickets']];
      const ticketId = asId(data.ticket_id);
      if (ticketId) keys.push(['support', 'ticket', ticketId]);
      return keys;
    }

    // A runner KYC document was approved / rejected — the verification banner
    // and the go-online gate both read the runner profile.
    case 'document_update':
      return [['runner', 'profile']];

    // Payout sent / failed, or a wallet credit landed.
    case 'payment':
      return [
        ['runner', 'payouts'],
        ['wallet'],
      ];

    // The runner ticked an extra stop. The tracking screen patches itself
    // straight from the payload (utils/stopProgress), so this only heals the
    // cached booking for the surfaces that refetch instead.
    case 'booking_stops_updated': {
      const bookingId = asId(data.booking_id);
      return bookingId ? [['booking', bookingId]] : [];
    }

    // An emergency alert on an errand both parties are on. Refresh the
    // booking surfaces so the receiving side's active screen reflects the
    // alert instead of leaving it to a badge increment nobody watches.
    case 'sos': {
      const keys: InvalidationKey[] = [
        ['booking', 'active'],
        ['bookings'],
        ['runner', 'errand', 'current'],
      ];
      const bookingId = asId(data.booking_id);
      if (bookingId) keys.push(['booking', bookingId]);
      return keys;
    }

    default:
      return [];
  }
}
