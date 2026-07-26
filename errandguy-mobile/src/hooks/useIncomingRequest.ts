import { useSupabaseRealtime } from './useSupabaseRealtime';
import { useRunnerStore } from '../stores/runnerStore';
import type { Booking } from '../types';

export function useIncomingRequest(runnerId: string | null) {
  // Per-field selector — this hook is mounted app-wide for runners; a whole-store
  // useRunnerStore() would re-run it on every unrelated runner-state write.
  const setIncomingRequest = useRunnerStore((s) => s.setIncomingRequest);

  const { isConnected } = useSupabaseRealtime({
    channel: `runner-requests:${runnerId}`,
    table: 'bookings',
    event: 'UPDATE',
    enabled: !!runnerId,
    filter: runnerId ? `runner_id=eq.${runnerId}` : undefined,
    onPayload: (payload) => {
      const booking = payload.new as Partial<Booking>;
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
