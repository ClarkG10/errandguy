/**
 * Where tapping a notification takes the user — one map for the device push
 * (useNotifications) and both in-app inboxes, so the two can never disagree.
 *
 * `surface` decides what happens to a notification with nowhere specific to
 * go (a staff announcement, a status note with no errand, a type this build
 * doesn't know yet): a PUSH opens the notifications screen, so the tap never
 * dead-ends on whatever screen the app happened to be on; a tap INSIDE the
 * inbox stays put (the row has been marked read, which is the whole action).
 */

export type NotificationRole = 'customer' | 'runner';
export type NotificationSurface = 'push' | 'inbox';

export interface NotificationTarget {
  /** The row's `type` column (mirrors `data.type` server-side). */
  type?: string | null;
  data?: Record<string, unknown> | null;
}

/** Accept string and numeric ids off the wire; reject anything else. */
function asId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function notificationsInboxRoute(role: NotificationRole): string {
  return role === 'runner' ? '/(runner)/notifications' : '/(customer)/(tabs)/notifications';
}

export function notificationRoute(
  target: NotificationTarget | null | undefined,
  role: NotificationRole,
  surface: NotificationSurface,
): string | null {
  const data = target?.data ?? {};
  const type =
    (typeof target?.type === 'string' && target.type) ||
    (typeof data.type === 'string' ? data.type : null);
  const isRunner = role === 'runner';
  const bookingId = asId(data.booking_id);
  const ticketId = asId(data.ticket_id);
  const fallback = surface === 'push' ? notificationsInboxRoute(role) : null;
  const errand = bookingId
    ? isRunner
      ? `/(runner)/errand/${bookingId}`
      : `/(customer)/tracking/${bookingId}`
    : null;

  switch (type) {
    // Anything about an errand opens that errand — for the runner, their
    // cockpit; for the customer, the tracking screen. An SOS is always about
    // a specific errand too.
    case 'booking_update':
    case 'shopping_items_updated':
    case 'booking_stops_updated':
    case 'sos':
      return errand ?? fallback;

    // A staff note. For the customer it is about their errand ("finding you a
    // new runner"); for a runner it is usually an errand staff took OFF them,
    // which their cockpit can no longer open — so the inbox.
    case 'system':
      return !isRunner && errand ? errand : fallback;

    // Land on the thing that was PAID FOR when the push names it; withdrawals,
    // payouts and a runner's cancellation fee land on the money screen.
    case 'payment':
      if (!isRunner && errand) return errand;
      return isRunner ? '/(runner)/(tabs)/earnings' : '/(customer)/wallet';

    case 'chat':
      return bookingId
        ? isRunner
          ? `/(runner)/chat/${bookingId}`
          : `/(customer)/chat/${bookingId}`
        : fallback;

    // An admin decision on a document, or the unfinished-application reminder.
    case 'document_update':
    case 'onboarding_reminder':
      return isRunner ? '/(runner)/settings/documents' : fallback;

    // Support replied / changed a ticket's status → that ticket's thread
    // (shared by both roles); without an id, the support inbox.
    case 'support_reply':
    case 'support_status':
      return ticketId ? `/(customer)/support/${ticketId}` : '/(customer)/support';

    // Staff announcements ('broadcast') and anything newer than this build.
    default:
      return fallback;
  }
}
