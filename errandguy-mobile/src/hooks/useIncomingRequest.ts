import { useEchoChannel } from './useEchoChannel';
import { useRunnerStore } from '../stores/runnerStore';
import { offerExpiresAt, readAcceptDeadline } from '../components/runner/offerMeta';
import type { Booking } from '../types';

interface UseIncomingRequestOptions {
  /**
   * Fired right after a direct offer is raised on screen, so the caller can
   * upgrade the thin realtime payload (no accept_deadline) to the full one.
   * Never fired for an offer the runner already declined.
   */
  onOffer?: (booking: Booking) => void;
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

  const { isConnected } = useEchoChannel({
    channel: `runner.${runnerId}`,
    event: 'booking.incoming',
    enabled: !!runnerId,
    // Payload is a BookingResource (offer view — no contact/PIN fields until
    // the runner accepts). Delivered directly, not wrapped in `{ new }`.
    onEvent: (payload) => {
      const booking = payload as Partial<Booking>;
      // Every offer is a direct one: matched to THIS runner. Anything else on
      // the channel is not an offer this runner can take.
      if (!booking.id || booking.status !== 'matched') return;
      // Never re-raise an offer the runner already turned down. A decline is
      // fire-and-forget, so the booking can still be `matched` server-side for
      // a moment and be re-sent; asking again reads as the app ignoring them.
      if (useRunnerStore.getState().isOfferDeclined(booking.id)) return;
      const offer = booking as Booking;
      setIncomingRequest({
        booking: offer,
        // Prefer the SERVER's accept-by cutoff (matched_at +
        // matched_acceptance_timeout_seconds, default 90s) over the old
        // hardcoded 30s, which closed the offer a full minute before the
        // server stopped honouring the accept. The Reverb offer projection
        // (App\Events\IncomingRequest) does not carry it yet, so the 30s
        // default still applies there until it does — onOffer's REST upgrade
        // and the home screen's /runner/errand/current reconcile then swap in
        // the real deadline.
        expiresAt: offerExpiresAt(readAcceptDeadline(offer)),
      });
      onOffer?.(offer);
    },
  });

  return { isConnected };
}
