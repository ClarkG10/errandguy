import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Booking, BookingStatus } from '../types';

/**
 * Persisted draft schema. We deliberately keep `activeBooking` and
 * `bookingHistory` out of storage — those are server-owned and stale
 * snapshots tend to mislead users on the next launch.
 */
interface PersistedDraftEnvelope {
  draft: DraftBooking;
  step: number;
  /** epoch ms */
  savedAt: number;
}

const DRAFT_STORAGE_KEY = '@booking_draft_v1';
/** Stale drafts older than this are silently dropped on hydration. */
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
/** Coalesce rapid keystrokes so we don't spam AsyncStorage on every char. */
const PERSIST_DEBOUNCE_MS = 250;

export interface DraftBooking {
  errand_type_id?: string;
  /** Slug of the selected errand type (e.g. 'transportation', 'food'). */
  errand_type_slug?: string;
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
  /** Pre-authorized maximum the runner may spend on items (food/grocery/purchase/bills). */
  shopping_budget?: number;
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
  /**
   * `true` once the persisted draft (if any) has been merged into the
   * store. Screens that need to pre-fill from the draft should wait
   * for this to flip true before reading `draftBooking`.
   */
  isDraftHydrated: boolean;

  setActiveBooking: (booking: Booking | null) => void;
  updateBookingStatus: (status: BookingStatus) => void;
  clearDraft: () => void;
  setStep: (step: number) => void;
  updateDraft: (data: Partial<DraftBooking>) => void;
  /** Read the persisted draft from AsyncStorage and merge it in. Idempotent. */
  loadDraftFromStorage: () => Promise<void>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const schedulePersist = (state: { draftBooking: DraftBooking; currentStep: number }) => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const envelope: PersistedDraftEnvelope = {
      draft: state.draftBooking,
      step: state.currentStep,
      savedAt: Date.now(),
    };
    // Empty drafts: just clear the row instead of writing `{}`.
    const isEmpty =
      Object.keys(state.draftBooking).length === 0 && state.currentStep === 0;
    if (isEmpty) {
      AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => {});
    } else {
      AsyncStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(envelope)).catch(
        () => {},
      );
    }
  }, PERSIST_DEBOUNCE_MS);
};

export const useBookingStore = create<BookingState>((set, get) => ({
  activeBooking: null,
  bookingHistory: [],
  currentStep: 0,
  draftBooking: {},
  isLoading: false,
  isDraftHydrated: false,

  setActiveBooking: (booking) => set({ activeBooking: booking }),

  updateBookingStatus: (status) => {
    const active = get().activeBooking;
    if (active) {
      set({ activeBooking: { ...active, status } });
    }
  },

  clearDraft: () => {
    set({ draftBooking: {}, currentStep: 0 });
    if (persistTimer) clearTimeout(persistTimer);
    AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => {});
  },

  setStep: (step) => {
    set({ currentStep: step });
    schedulePersist(get());
  },

  updateDraft: (data) => {
    set((state) => ({ draftBooking: { ...state.draftBooking, ...data } }));
    schedulePersist(get());
  },

  loadDraftFromStorage: async () => {
    if (get().isDraftHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        set({ isDraftHydrated: true });
        return;
      }
      const envelope = JSON.parse(raw) as PersistedDraftEnvelope;
      const fresh =
        envelope?.savedAt &&
        Date.now() - envelope.savedAt < DRAFT_MAX_AGE_MS &&
        envelope.draft &&
        typeof envelope.draft === 'object';
      if (fresh) {
        set({
          draftBooking: envelope.draft,
          currentStep: typeof envelope.step === 'number' ? envelope.step : 0,
          isDraftHydrated: true,
        });
      } else {
        await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
        set({ isDraftHydrated: true });
      }
    } catch {
      // Corrupt payload — wipe it so we don't keep failing.
      await AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => {});
      set({ isDraftHydrated: true });
    }
  },
}));
