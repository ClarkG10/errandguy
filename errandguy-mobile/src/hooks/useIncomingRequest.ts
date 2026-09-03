import { useEchoChannel } from './useEchoChannel';
import { useRunnerStore } from '../stores/runnerStore';
import { offerExpiresAt, readAcceptDeadline } from '../components/runner/offerMeta';
import type { Booking } from '../types';

interface UseIncomingRequestOptions {
  /**
   * Fired for EVERY offer broadcast on the runner's channel, matched or not,
   * so the caller can refresh the open-offers feed the moment dispatch runs
   * instead of waiting out its staleTime.
   */
  onOffer?: (booking: Partial<Booking>) => void;
  /**
   * An errand this runner was offered is no longer claimable — someone else
   * took it, it expired, or the customer cancelled. Refresh the feed so the
   * dead card goes rather than waiting for the runner to tap it and be told
   * BOOKING_STALE.
   */
  onOfferWithdrawn?: (bookingId: string) => void;
}

/**
 * The runner's offer stream.
 *
 * ONE owner: `OfferWatcher` in app/(runner)/_layout.tsx. It is mounted at the
 * group layout — above the Tabs and above every pushed stack screen — because
 * the runner tabs are `freezeOnBlur`, so while this lived on the Home tab an
 * offer arriving to a runner reading Earnings, History or Busy-areas raised
 * nothing at all. Do not add a second call site: useEchoChannel refcounts the
 * channel, but each mount adds its own listener, so a second one would fire
 * every callback twice.
 */
export function useIncomingRequest(
  runnerId: string | null,
  options?: UseIncomingRequestOptions,
) {
  // Per-field selector — a whole-store useRunnerStore() would re-run this on
  // every unrelated runner-state write (and it now sits at the layout, i.e.
  // mounted for the whole shift).
  const setIncomingRequest = useRunnerStore((s) => s.setIncomingRequest);
  const onOffer = options?.onOffer;
  const onOfferWithdrawn = options?.onOfferWithdrawn;

  const { isConnected } = useEchoChannel({
    channel: `runner.${runnerId}`,
    event: 'booking.incoming',
    enabled: !!runnerId,
    // Payload is a BookingResource (offer view — no contact/PIN fields until
    // the runner accepts). Delivered directly, not wrapped in `{ new }`.
    onEvent: (payload) => {
      const booking = payload as Partial<Booking>;
      onOffer?.(booking);
      // Never re-raise an offer the runner already turned down. A decline is
      // fire-and-forget, so the booking can still be `matched` server-side for
      // a moment and be re-broadcast; asking again reads as the app ignoring
      // them. (The feed callback above still runs — the errand may legitimately
      // reappear as an open offer for someone to claim.)
      if (booking.id && useRunnerStore.getState().isOfferDeclined(booking.id)) return;
      if (booking.status === 'matched') {
        setIncomingRequest({
          booking: booking as Booking,
          // Prefer the SERVER's acceptance cutoff (matched_at +
          // matched_acceptance_timeout_seconds, default 90s) over the old
          // hardcoded 30s, which closed the offer a full minute before the
          // server stopped honouring the accept. The Reverb offer projection
          // (App\Events\IncomingRequest) does not carry it yet, so the 30s
          // default still applies there until it does — the home screen's
          // /runner/errand/current reconcile then upgrades the deadline.
          expiresAt: offerExpiresAt(readAcceptDeadline(booking as Booking)),
        });
      }
    },
  });

  // Retraction rides the runner's own notification stream (the same channel the
  // offer card arrived on), because the server withdraws the offer by deleting
  // that card. Without this the row only disappears on the next fetch, so a
  // runner looking at the feed keeps a live-looking offer they can only
  // discover is gone by tapping it. Separate subscription rather than a second
  // event on `runner.{id}`: useEchoChannel binds one event per channel.
  useEchoChannel({
    channel: `notifications.${runnerId}`,
    event: 'offer.withdrawn',
    enabled: !!runnerId,
    onEvent: (payload) => {
      const bookingId = (payload as { booking_id?: string })?.booking_id;
      if (!bookingId) return;

      // Close the offer modal only if it is showing THIS errand — never a
      // different offer the runner is still deciding on.
      const open = useRunnerStore.getState().incomingRequest;
      if (open?.booking?.id === bookingId) {
        setIncomingRequest(null);
      }

      onOfferWithdrawn?.(bookingId);
    },
  });

  return { isConnected };
}
