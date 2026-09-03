import type { BookingStatus } from '../types';

/**
 * Monotonic rank of every status a booking moves through, plus the terminal
 * set — the two facts every screen that consumes a `booking.status` broadcast
 * needs in order to merge it safely.
 *
 * Lifted out of the runner cockpit (where it lived as a private const) because
 * the navigation screen needs the IDENTICAL rule: it now subscribes to the same
 * channel, and two different backwards-guards on one broadcast is exactly the
 * kind of drift that ends with a live navigation torn down by a late event.
 *
 * Terminal statuses deliberately bypass the rank check: a cancellation must
 * always win, whatever it arrives after.
 */
export const STATUS_RANK: Record<string, number> = {
  pending: 0,
  matched: 1,
  accepted: 2,
  heading_to_pickup: 3,
  arrived_at_pickup: 4,
  picked_up: 5,
  in_transit: 6,
  arrived_at_dropoff: 7,
  delivered: 8,
  completed: 9,
};

/** No further participant action is possible on these. */
export const TERMINAL_STATUSES: string[] = ['completed', 'cancelled', 'no_runner'];

export const isTerminalStatus = (status?: string | null): boolean =>
  !!status && TERMINAL_STATUSES.includes(status);

/**
 * True when `incoming` would move a screen BACKWARDS from `current` — a late
 * broadcast for a transition the runner has already advanced past. Unknown
 * statuses and terminal ones are never "backwards" (see above).
 */
export const isStatusBackwards = (
  incoming?: string | null,
  current?: string | null,
): boolean => {
  if (!incoming || !current) return false;
  if (isTerminalStatus(incoming)) return false;
  const a = STATUS_RANK[incoming];
  const b = STATUS_RANK[current];
  return a != null && b != null && a < b;
};

/** Narrowing helper for the two statuses the runner store treats as "clear". */
export const isClosedStatus = (
  status?: string | null,
): status is Extract<BookingStatus, 'completed' | 'cancelled'> =>
  status === 'completed' || status === 'cancelled';
