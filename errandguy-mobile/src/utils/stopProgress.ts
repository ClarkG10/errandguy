import type { BookingStop } from '../types/booking';

/**
 * The customer-facing half of multi-stop progress.
 *
 * The runner ticks stops off in the cockpit and the server pushes a
 * `booking_stops_updated` in-app notification (RunnerErrandController::
 * completeStop — broadcast-only, no device buzz per tick). Until this consumer
 * existed the payload arrived and died in the inbox: nothing patched the
 * tracking screen, so the cockpit's "the customer sees it land live" promise
 * was false and every tick just incremented the customer's unread badge.
 *
 * Mirrors utils/shoppingChecklist's notification helper — pure and
 * unit-testable without a socket.
 */

/** The notification type `RunnerErrandController::completeStop` emits. */
export const BOOKING_STOPS_UPDATED = 'booking_stops_updated';

export interface StopsSignal {
  type?: string | null;
  data?: Record<string, unknown> | null;
}

interface StopCompletion {
  id: string;
  completed_at: string | null;
}

/**
 * Pull the per-stop completion state out of a `booking_stops_updated`
 * notification. Returns null — "not for us, change nothing" — for any other
 * type, another booking, or a payload we can't trust.
 *
 * The payload is deliberately PARTIAL ({id, sequence, completed_at} — no
 * address), so the caller must MERGE it into the stops it already holds
 * rather than replace them: see mergeStopCompletions.
 */
export function stopCompletionsFromNotification(
  signal: StopsSignal | null | undefined,
  bookingId: string | null | undefined,
): StopCompletion[] | null {
  if (!signal || !bookingId) return null;
  const data = signal.data ?? {};
  const type =
    typeof data.type === 'string' && data.type !== ''
      ? data.type
      : typeof signal.type === 'string'
        ? signal.type
        : '';
  if (type !== BOOKING_STOPS_UPDATED) return null;
  if (data.booking_id !== bookingId) return null;

  const raw = data.stops;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const updates: StopCompletion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || row.id === '') return null;
    updates.push({
      id: row.id,
      completed_at:
        typeof row.completed_at === 'string' && row.completed_at !== ''
          ? row.completed_at
          : null,
    });
  }
  return updates;
}

/**
 * Merge completion timestamps into the full stops the booking already carries.
 * Returns a new array when anything changed, or null when the merge is a
 * no-op (unknown ids only, or every value already matches) so callers can
 * skip a store write that would only cause a re-render.
 */
export function mergeStopCompletions(
  stops: BookingStop[] | null | undefined,
  updates: StopCompletion[] | null | undefined,
): BookingStop[] | null {
  if (!stops?.length || !updates?.length) return null;
  const byId = new Map(updates.map((u) => [u.id, u.completed_at]));
  let changed = false;
  const next = stops.map((stop) => {
    if (!byId.has(stop.id)) return stop;
    const completedAt = byId.get(stop.id) ?? null;
    if ((stop.completed_at ?? null) === completedAt) return stop;
    changed = true;
    return { ...stop, completed_at: completedAt };
  });
  return changed ? next : null;
}
