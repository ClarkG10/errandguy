import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PaymentMethodType } from '../types';

/**
 * Device-local Appearance & Accessibility preferences, plus the small
 * per-account "how you last paid" memory the booking review screen reads.
 *
 * These are per-device comfort settings (not account data): whether to quiet
 * haptics and force reduced motion regardless of the OS toggle. They persist
 * across launches so the app remembers how a user likes it to feel.
 *
 * Mirrors the hand-rolled AsyncStorage + `isHydrated` pattern of bookingStore /
 * paymentStore (no zustand persist middleware, to match the codebase). Unlike a
 * money attempt these writes are cheap and non-critical, so every persist is
 * fire-and-forget with the rejection swallowed.
 *
 * Self-hydrates on first import (see the bottom of this file) so the two hot
 * consumers — `haptics` (a plain module, not a component) and
 * `useReducedMotion` — see the stored values without any boot wiring.
 */
// Future: a `themeMode: 'system' | 'light' | 'dark'` will live here once the
// app grows a dark theme. Intentionally NOT wired yet — adding it now would
// imply a theme switch that does nothing. Leave this note as the drop-in point.
// export type ThemeMode = 'system' | 'light' | 'dark';

export interface AppearancePreferences {
  /** Suppress every centralized `haptics.*` fire (vibration feedback off). */
  reduceHaptics: boolean;
  /** Force reduced motion ON regardless of the OS setting. The OS value stays
   *  the base — this can only ADD reduction, never re-enable motion the OS
   *  has already suppressed. */
  reduceMotionOverride: boolean;
  // themeMode: ThemeMode; // future — see note above; do NOT wire theme now.
}

/**
 * How a booking was last SUCCESSFULLY paid for, so the next booking
 * pre-selects it instead of resetting to Cash.
 *
 * Display/convenience only: this is a PRE-selection the customer still sees
 * (and can change) on the review screen before confirming, and the amount is
 * on the Confirm button. It never changes what the server charges — the
 * submitted `payment_method` is always whatever the selector is showing.
 */
export interface LastPaymentMethod {
  type: PaymentMethodType;
  /** Epoch ms of the booking that recorded it. */
  savedAt: number;
}

const PAYMENT_METHOD_TYPES: readonly string[] = ['gcash', 'maya', 'wallet', 'cash'];

/**
 * Keep only remembered methods that can still be offered.
 *
 * The build before the launch simplification stored `{ id, type }`, where the
 * type could be a card or GrabPay and the id a saved card or linked account.
 * Those are retired, so such an entry is dropped (the next booking falls back
 * to the default pick); a GCash, Maya, wallet or cash memory carries over,
 * minus the id nothing reads any more.
 */
const sanitizePaymentMemory = (raw: unknown): Record<string, LastPaymentMethod> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, LastPaymentMethod> = {};
  for (const [userId, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as Partial<LastPaymentMethod> | null;
    if (e && typeof e.type === 'string' && PAYMENT_METHOD_TYPES.includes(e.type)) {
      out[userId] = { type: e.type, savedAt: Number(e.savedAt) || 0 };
    }
  }
  return out;
};

const STORAGE_KEY = '@appearance_prefs_v1';
/** Kept OUT of the appearance blob: it's account-scoped, not device comfort. */
const PAYMENT_MEMORY_KEY = '@last_payment_method_v1';

const DEFAULTS: AppearancePreferences = {
  reduceHaptics: false,
  reduceMotionOverride: false,
};

const persist = (prefs: AppearancePreferences) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
};

const persistPaymentMemory = (map: Record<string, LastPaymentMethod>) => {
  AsyncStorage.setItem(PAYMENT_MEMORY_KEY, JSON.stringify(map)).catch(() => {});
};

interface PreferencesStoreState extends AppearancePreferences {
  isHydrated: boolean;
  /** Keyed by user id so one device shared by two accounts never crosses
   *  their payment memories (clearLastPaymentMethods() is the belt-and-braces
   *  wipe for an account-scope reset). */
  lastPaymentMethods: Record<string, LastPaymentMethod>;

  setReduceHaptics: (value: boolean) => void;
  setReduceMotionOverride: (value: boolean) => void;
  setLastPaymentMethod: (userId: string, type: PaymentMethodType) => void;
  /** Wipe every remembered selection (account-scope reset / logout). */
  clearLastPaymentMethods: () => void;
  loadFromStorage: () => Promise<void>;
}

const snapshot = (s: AppearancePreferences): AppearancePreferences => ({
  reduceHaptics: s.reduceHaptics,
  reduceMotionOverride: s.reduceMotionOverride,
});

export const usePreferencesStore = create<PreferencesStoreState>((set, get) => ({
  ...DEFAULTS,
  isHydrated: false,
  lastPaymentMethods: {},

  setReduceHaptics: (value) => {
    set({ reduceHaptics: value });
    persist(snapshot(get()));
  },

  setReduceMotionOverride: (value) => {
    set({ reduceMotionOverride: value });
    persist(snapshot(get()));
  },

  setLastPaymentMethod: (userId, type) => {
    if (!userId || !type) return;
    const next = {
      ...get().lastPaymentMethods,
      [userId]: { type, savedAt: Date.now() },
    };
    set({ lastPaymentMethods: next });
    persistPaymentMemory(next);
  },

  clearLastPaymentMethods: () => {
    set({ lastPaymentMethods: {} });
    AsyncStorage.removeItem(PAYMENT_MEMORY_KEY).catch(() => {});
  },

  loadFromStorage: async () => {
    if (get().isHydrated) return;
    // One multiGet for both blobs — the payment memory must land in the SAME
    // hydration tick as the appearance prefs, because PaymentMethodSelector
    // gates its auto-pick on `isHydrated` (see the comment there).
    try {
      const pairs = await AsyncStorage.multiGet([STORAGE_KEY, PAYMENT_MEMORY_KEY]);
      const byKey = Object.fromEntries(pairs) as Record<string, string | null>;

      let saved: Partial<AppearancePreferences> = {};
      try {
        const raw = byKey[STORAGE_KEY];
        if (raw) saved = JSON.parse(raw) as Partial<AppearancePreferences>;
      } catch {
        /* corrupt appearance blob — fall back to defaults */
      }

      let lastPaymentMethods: Record<string, LastPaymentMethod> = {};
      try {
        const raw = byKey[PAYMENT_MEMORY_KEY];
        // Only a plain object map of methods that still exist — a corrupt or
        // retired entry must not poison the selector's auto-pick.
        lastPaymentMethods = sanitizePaymentMemory(raw ? JSON.parse(raw) : null);
      } catch {
        /* corrupt payment memory — start empty */
      }

      // Merge over defaults so a stored blob missing a future key still
      // resolves to a sane, fully-typed value.
      set({ ...DEFAULTS, ...saved, lastPaymentMethods, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },
}));

// Self-hydrate on first import. `haptics` and `useReducedMotion` both pull this
// store before any screen mounts, so there is no natural boot hook to hang the
// load on — kick it off here (idempotent via the `isHydrated` guard).
void usePreferencesStore.getState().loadFromStorage();
