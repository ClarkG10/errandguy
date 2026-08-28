import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useBookingStore } from '../../stores/bookingStore';
import { useRunnerStore } from '../../stores/runnerStore';
import { bookingService } from '../../services/booking.service';
import { runnerService } from '../../services/runner.service';
import type { Booking } from '../../types';

/**
 * Who am I talking to, and is this thread still live?
 *
 * Both chat screens used to answer that question from ONE source — the
 * role's "current booking" store slot — and only when its id happened to
 * match the route. Opening a conversation from the inbox (a just-finished
 * errand, a second concurrent booking, or simply after the store cleared on
 * a cold start) therefore showed a generic "Runner" / "Customer" title and a
 * permanently disabled call button, even though the row the user tapped
 * displayed the counterparty's real name.
 *
 * This resolves identity through three sources, best first:
 *   1. the role's live booking store, when it holds THIS booking;
 *   2. the `name` / `status` route params the inbox row hands over, so the
 *      header is correct on the very first frame (no fetch, no flicker);
 *   3. a one-shot booking fetch — the only source that carries the phone
 *      number, so the call button comes back too. Both endpoints are
 *      `silent` + micro-cached, so this coalesces with anything in flight
 *      and never blinks the global progress bar.
 *
 * It also reports the booking status, which the screens use to make a closed
 * thread read-only instead of letting the user type a message the server will
 * reject with a 422 (ChatController::store).
 *
 * Lives under components/chat rather than hooks/ because it is owned by, and
 * only used by, the two chat thread screens.
 */

/**
 * Statuses on which the thread is over. `completed` / `cancelled` are the two
 * the SERVER rejects sends on; `no_runner` is added because there is nobody on
 * the other end of that thread at all.
 */
const CLOSED_STATUSES = ['completed', 'cancelled', 'no_runner'];

export function isClosedBookingStatus(status?: string | null): boolean {
  return !!status && CLOSED_STATUSES.includes(status);
}

export interface ChatPeer {
  /** Header title. Falls back to a role-appropriate generic, never empty. */
  name: string;
  /** tel: target for the call button, or null when we genuinely have none. */
  phone: string | null;
  /** Booking status backing this thread, or null while still unknown. */
  status: string | null;
  /**
   * True only once we KNOW the errand has ended. Unknown status → false, so
   * the composer fails open (the server stays the real enforcement).
   */
  isClosed: boolean;
}

/** Route params the inbox row seeds so the header is right on frame one. */
type ChatRouteParams = { name?: string | string[]; status?: string | string[] };

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (Array.isArray(value)) return firstParam(value[0]);
  return null;
}

export function useChatPeer(
  bookingId: string,
  role: 'customer' | 'runner',
): ChatPeer {
  const params = useLocalSearchParams<ChatRouteParams>();
  const paramName = firstParam(params.name);
  const paramStatus = firstParam(params.status);

  // Both stores are read unconditionally (hook rules); only the one matching
  // `role` is ever consulted, and a selector that returns the same reference
  // doesn't re-render.
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const currentErrand = useRunnerStore((s) => s.currentErrand);
  const roleBooking = role === 'customer' ? activeBooking : currentErrand;
  const storeBooking =
    roleBooking && roleBooking.id === bookingId ? roleBooking : null;

  const [fetched, setFetched] = useState<Booking | null>(null);

  useEffect(() => {
    if (!bookingId) return;
    // The store already has this thread's booking — nothing to fetch.
    if (storeBooking) return;
    // Already fetched (or already failed once — deps don't change, so this
    // stays a single attempt rather than a retry loop).
    if (fetched?.id === bookingId) return;

    let cancelled = false;
    (async () => {
      try {
        const res =
          role === 'customer'
            ? await bookingService.getBooking(bookingId)
            : await runnerService.getErrand(bookingId);
        const booking = res?.data?.data as Booking | undefined;
        if (!cancelled && booking?.id) setFetched(booking);
      } catch {
        // Best-effort: the header keeps the route-param name and the call
        // button stays disabled, i.e. exactly the old behaviour.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, role, storeBooking, fetched?.id]);

  const source = storeBooking ?? (fetched?.id === bookingId ? fetched : null);
  const peer = role === 'customer' ? source?.runner : source?.customer;

  const name =
    peer?.full_name?.trim() ||
    paramName ||
    (role === 'customer' ? 'Runner' : 'Customer');

  // Runner side keeps the existing precedence: the errand's dropoff/pickup
  // contact is who the runner actually needs on the phone, with the
  // customer's account number as the last resort.
  const phone =
    role === 'customer'
      ? peer?.phone ?? null
      : source?.dropoff_contact_phone ??
        source?.pickup_contact_phone ??
        peer?.phone ??
        null;

  const status = source?.status ?? paramStatus;

  return { name, phone, status, isClosed: isClosedBookingStatus(status) };
}
