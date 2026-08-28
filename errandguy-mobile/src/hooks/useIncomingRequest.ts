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
}

export function useIncomingRequest(
  runnerId: string | null,
  options?: UseIncomingRequestOptions,
) {
  // Per-field selector — this hook is mounted app-wide for runners; a whole-store
  // useRunnerStore() would re-run it on every unrelated runner-state write.
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
      onOffer?.(booking);
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

  return { isConnected };
}
