import { useEchoChannel } from './useEchoChannel';
import { useBookingStore } from '../stores/bookingStore';
import type { Booking, BookingStatus } from '../types';

export function useBookingStatus(bookingId: string | null) {
  // Use individual selectors so unrelated store updates don't recreate
  // these references and re-subscribe the realtime channel on every render.
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const updateBookingStatus = useBookingStore((s) => s.updateBookingStatus);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);

  const { isConnected } = useEchoChannel({
    channel: `booking.${bookingId}`,
    event: 'booking.status',
    enabled: !!bookingId,
    // Payload is BookingStatusChanged::broadcastWith() — the lifecycle fields
    // directly (no Supabase `{ new }` envelope). Same merge semantics as before.
    onEvent: (payload) => {
      const updated = payload as Partial<Booking>;
      if (updated.status) {
        updateBookingStatus(updated.status as BookingStatus);
      }

      if (activeBooking && updated) {
        setActiveBooking({ ...activeBooking, ...updated } as Booking);
      }
    },
  });

  return { isConnected };
}
