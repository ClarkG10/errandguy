import { useEffect } from 'react';
import { useSupabaseRealtime } from './useSupabaseRealtime';
import { useBookingStore } from '../stores/bookingStore';
import type { Booking, BookingStatus } from '../types';

export function useBookingStatus(bookingId: string | null) {
  // Use individual selectors so unrelated store updates don't recreate
  // these references and re-subscribe the realtime channel on every render.
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const updateBookingStatus = useBookingStore((s) => s.updateBookingStatus);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);

  const { isConnected } = useSupabaseRealtime({
    channel: `booking:${bookingId}`,
    table: 'bookings',
    event: 'UPDATE',
    filter: bookingId ? `id=eq.${bookingId}` : undefined,
    onPayload: (payload) => {
      const updated = payload.new as Partial<Booking>;
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
