import { useCallback } from 'react';
import { useBookingStore } from '../stores/bookingStore';
import { bookingService } from '../services/booking.service';
import type { Booking } from '../types';

export function useBooking() {
  const {
    activeBooking,
    bookingHistory,
    currentStep,
    draftBooking,
    isLoading,
    setActiveBooking,
    updateBookingStatus,
    clearDraft,
    setStep,
    updateDraft,
  } = useBookingStore();

  const createBooking = useCallback(async () => {
    const response = await bookingService.createBooking(draftBooking as any);
    const booking: Booking = response.data.data;
    setActiveBooking(booking);
    clearDraft();
    return booking;
  }, [draftBooking, setActiveBooking, clearDraft]);

  const cancelBooking = useCallback(
    async (id: string, reason?: string) => {
      await bookingService.cancelBooking(id, reason);
      updateBookingStatus('cancelled');
    },
    [updateBookingStatus],
  );

  const fetchActiveBooking = useCallback(async () => {
    const response = await bookingService.getActiveBooking();
    const booking: Booking | null = response.data.data;
    setActiveBooking(booking);
    return booking;
  }, [setActiveBooking]);

  return {
    activeBooking,
    bookingHistory,
    currentStep,
    draftBooking,
    isLoading,
    createBooking,
    cancelBooking,
    fetchActiveBooking,
    updateBookingStatus,
    clearDraft,
    setStep,
    updateDraft,
  };
}
