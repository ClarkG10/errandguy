import type { Booking } from '../../types';
import { STATUS_RANK, isTerminalStatus } from '../../constants/statusRank';
import { useRunnerStore } from '../../stores/runnerStore';
import { invalidateQuery } from '../../hooks/useQuery';
import { toast } from '../../stores/toastStore';
import { haptics } from '../../utils/haptics';

/**
 * Support can take an errand off a runner and send it back to matching
 * (BookingService::adminReturnToMatching). The server tells the old runner by
 * broadcasting `booking.status` with `status: 'pending'` and `runner_id: null`
 * on the booking channel they are still subscribed to.
 *
 * Every runner surface used to read that as a late, lower-ranked status and
 * drop it, so the runner kept driving to a job that was no longer theirs while
 * the fallback poll quietly 404'd. These helpers turn it into a clear exit.
 */

export const REASSIGNED_MESSAGE = 'This errand was reassigned by support.';

/** Said when the server simply stops returning the errand to us (a 404/403
 *  from the poll) — we know it is gone, not why. */
export const NO_LONGER_YOURS_MESSAGE = 'This errand is no longer assigned to you.';

/**
 * True when a `booking.status` broadcast says an errand this runner was
 * WORKING (accepted or later) now belongs to nobody, or to someone else.
 *
 * Deliberately narrow:
 *  - An offer the runner never accepted (`matched`) drops back to `pending`
 *    when it lapses or they decline it; that is not support taking a job away
 *    and must not be announced as one.
 *  - Terminal statuses keep their own handling (a cancellation always wins).
 *  - A payload without a `runner_id` key says nothing about ownership.
 */
export function isTakenOffBroadcast(
  incoming: Partial<Booking> | null | undefined,
  current: Pick<Booking, 'id' | 'status'> | null | undefined,
  myUserId: string | null | undefined,
): boolean {
  if (!incoming || !current || !myUserId) return false;
  if (incoming.id && incoming.id !== current.id) return false;
  if (!incoming.status || isTerminalStatus(incoming.status)) return false;
  if (isTerminalStatus(current.status)) return false;
  if (!('runner_id' in incoming)) return false;
  const rank = STATUS_RANK[current.status];
  if (rank == null || rank < STATUS_RANK.accepted) return false;
  const owner = incoming.runner_id;
  return owner == null || String(owner) !== String(myUserId);
}

/** Same booking announced within this window is the same event reaching a
 *  second surface (home, cockpit and turn-by-turn all listen). */
const ANNOUNCE_DEDUPE_MS = 10_000;
let lastAnnounced: { id: string; at: number } | null = null;

/**
 * Drop an errand the runner no longer holds: clear it from the store (which
 * also drops the GPS back to the idle profile), forget every cached copy so no
 * screen paints it again, and tell the runner once — however many surfaces
 * heard the same broadcast.
 */
export function releaseTakenOffErrand(
  bookingId: string,
  message: string = REASSIGNED_MESSAGE,
): void {
  const store = useRunnerStore.getState();
  if (store.currentErrand?.id === bookingId) {
    useRunnerStore.setState({ currentErrand: null });
  }
  void invalidateQuery(['runner', 'errand']);

  const now = Date.now();
  if (lastAnnounced?.id === bookingId && now - lastAnnounced.at < ANNOUNCE_DEDUPE_MS) {
    return;
  }
  lastAnnounced = { id: bookingId, at: now };
  haptics.warning();
  toast.warning(message);
}

/** Test hook: forget the last announcement. */
export function __resetTakenOffAnnouncements(): void {
  lastAnnounced = null;
}
