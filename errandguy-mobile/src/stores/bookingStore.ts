import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Booking, BookingStatus } from '../types';
import type { ChecklistItem, DraftStop } from '../types/booking';

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
  /**
   * The booking-create idempotency key for THIS draft, and the payload
   * signature it was minted against.
   *
   * It has to live in the envelope rather than in a component ref because the
   * ref dies with the process and the draft does not. A customer who force-quits
   * during the multi-second create — after the server has persisted the booking
   * but before the response lands — comes back to a resume card; confirming it
   * with a fresh key made the server treat it as a brand-new request and create
   * a SECOND errand with a SECOND charge. Two runners dispatched to one pickup.
   *
   * The signature preserves the required semantics: an EDITED draft must mint a
   * new key (the server hashes the whole body), while an untouched resumed draft
   * replays the same one and EnsureIdempotency returns the original booking.
   */
  createKey?: string | null;
  createKeySig?: string | null;
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
  /** Extra destinations after the primary dropoff (multi-stop). Sent verbatim
   *  to POST /bookings as `stops`. Absent/[] for a normal single-drop booking. */
  stops?: DraftStop[];
  description?: string;
  special_instructions?: string;
  item_photos?: string[];
  estimated_item_value?: number;
  /** Pre-authorized maximum the runner may spend on items (food/grocery/purchase/bills). */
  shopping_budget?: number;
  /**
   * Client-side shopping checklist for errand types that require a
   * shopping budget. Serialized into `description` at submit (there is no
   * structured items column on the API). See `utils/shoppingChecklist`.
   */
  shoppingItems?: ChecklistItem[];
  pricing_mode?: 'fixed' | 'negotiate';
  schedule_type?: 'now' | 'scheduled';
  scheduled_at?: string;
  vehicle_type_rate?: string;
  customer_offer?: number;
  payment_method_id?: string;
  promo_code?: string;
  /** Validated saving for `promo_code` in pesos — persisted alongside it so
   *  the review screen can restore the discount line after a remount
   *  instead of showing an applied chip with an undiscounted total. */
  promo_discount?: number;
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
  /** Idempotency key for the in-flight create, persisted with the draft. */
  createKey: string | null;
  createKeySig: string | null;
  setCreateKey: (key: string | null, sig: string | null) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const schedulePersist = (state: {
  draftBooking: DraftBooking;
  currentStep: number;
  createKey: string | null;
  createKeySig: string | null;
}) => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const envelope: PersistedDraftEnvelope = {
      draft: state.draftBooking,
      step: state.currentStep,
      savedAt: Date.now(),
      createKey: state.createKey,
      createKeySig: state.createKeySig,
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
  createKey: null,
  createKeySig: null,

  setActiveBooking: (booking) => set({ activeBooking: booking }),

  updateBookingStatus: (status) => {
    const active = get().activeBooking;
    if (active) {
      set({ activeBooking: { ...active, status } });
    }
  },

  setCreateKey: (key, sig) => {
    set({ createKey: key, createKeySig: sig });
    // Persist IMMEDIATELY rather than through the debounce: the whole point is
    // to survive a kill that can land during the create request itself, and a
    // 250ms window is exactly when the customer is staring at the overlay
    // deciding whether it has hung.
    const s = get();
    AsyncStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        draft: s.draftBooking,
        step: s.currentStep,
        savedAt: Date.now(),
        createKey: key,
        createKeySig: sig,
      } satisfies PersistedDraftEnvelope),
    ).catch(() => {});
  },

  clearDraft: () => {
    // The key dies with the draft — a NEW booking must never replay the
    // previous one's key, or idempotency would return the old booking.
    set({ draftBooking: {}, currentStep: 0, createKey: null, createKeySig: null });
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
          createKey: envelope.createKey ?? null,
          createKeySig: envelope.createKeySig ?? null,
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
