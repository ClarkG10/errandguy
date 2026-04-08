import { useEffect } from 'react';
import { useSupabaseRealtime } from './useSupabaseRealtime';
import { useBookingStore } from '../stores/bookingStore';
import type { Booking, BookingStatus } from '../types';

export function useBookingStatus(bookingId: string | null) {
  const { activeBooking, updateBookingStatus, setActiveBooking } = useBookingStore();

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
