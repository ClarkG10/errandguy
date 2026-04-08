import { useSupabaseRealtime } from './useSupabaseRealtime';
import { useRunnerStore } from '../stores/runnerStore';
import type { Booking } from '../types';

export function useIncomingRequest(runnerId: string | null) {
  const { setIncomingRequest } = useRunnerStore();

  const { isConnected } = useSupabaseRealtime({
    channel: `runner-requests:${runnerId}`,
    table: 'bookings',
    event: 'UPDATE',
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
