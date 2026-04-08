import { create } from 'zustand';
import type { Booking, BookingStatus } from '../types';

export interface DraftBooking {
  errand_type_id?: string;
  pickup_address?: string;
  pickup_lat?: number;
  pickup_lng?: number;
  pickup_contact_name?: string;
  pickup_contact_phone?: string;
  dropoff_address?: string;
  dropoff_lat?: number;
  dropoff_lng?: number;
  dropoff_contact_name?: string;
  dropoff_contact_phone?: string;
  description?: string;
  special_instructions?: string;
  item_photos?: string[];
  estimated_item_value?: number;
  pricing_mode?: 'fixed' | 'negotiate';
  schedule_type?: 'now' | 'scheduled';
  scheduled_at?: string;
  vehicle_type_rate?: string;
  customer_offer?: number;
  payment_method_id?: string;
  promo_code?: string;
  instructions?: string;
  offered_price?: number;
  items?: Array<{ name: string; quantity: number; estimated_price?: number }>;
}

interface BookingState {
  activeBooking: Booking | null;
  bookingHistory: Booking[];
  currentStep: number;
  draftBooking: DraftBooking;
  isLoading: boolean;

  setActiveBooking: (booking: Booking | null) => void;
  updateBookingStatus: (status: BookingStatus) => void;
  clearDraft: () => void;
  setStep: (step: number) => void;
  updateDraft: (data: Partial<DraftBooking>) => void;
}

export const useBookingStore = create<BookingState>((set, get) => ({
  activeBooking: null,
  bookingHistory: [],
  currentStep: 0,
  draftBooking: {},
  isLoading: false,

  setActiveBooking: (booking) => set({ activeBooking: booking }),

  updateBookingStatus: (status) => {
    const active = get().activeBooking;
    if (active) {
      set({ activeBooking: { ...active, status } });
    }
  },

  clearDraft: () => set({ draftBooking: {}, currentStep: 0 }),

  setStep: (step) => set({ currentStep: step }),

  updateDraft: (data) =>
    set((state) => ({
      draftBooking: { ...state.draftBooking, ...data },
    })),
}));
