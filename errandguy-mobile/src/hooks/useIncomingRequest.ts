import { useEchoChannel } from './useEchoChannel';
import { useRunnerStore } from '../stores/runnerStore';
import type { Booking } from '../types';

export function useIncomingRequest(runnerId: string | null) {
  // Per-field selector — this hook is mounted app-wide for runners; a whole-store
  // useRunnerStore() would re-run it on every unrelated runner-state write.
  const setIncomingRequest = useRunnerStore((s) => s.setIncomingRequest);

  const { isConnected } = useEchoChannel({
    channel: `runner.${runnerId}`,
    event: 'booking.incoming',
    enabled: !!runnerId,
    // Payload is a BookingResource (offer view — no contact/PIN fields until
    // the runner accepts). Delivered directly, not wrapped in `{ new }`.
    onEvent: (payload) => {
      const booking = payload as Partial<Booking>;
      if (booking.status === 'matched') {
        setIncomingRequest({
          booking: booking as Booking,
          expiresAt: Date.now() + 30_000,
        });
      }
    },
  });

  return { isConnected };
}
