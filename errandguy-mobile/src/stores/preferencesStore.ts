import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local Appearance & Accessibility preferences.
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

const STORAGE_KEY = '@appearance_prefs_v1';

const DEFAULTS: AppearancePreferences = {
  reduceHaptics: false,
  reduceMotionOverride: false,
};

const persist = (prefs: AppearancePreferences) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
};

interface PreferencesStoreState extends AppearancePreferences {
  isHydrated: boolean;

  setReduceHaptics: (value: boolean) => void;
  setReduceMotionOverride: (value: boolean) => void;
  loadFromStorage: () => Promise<void>;
}

const snapshot = (s: AppearancePreferences): AppearancePreferences => ({
  reduceHaptics: s.reduceHaptics,
  reduceMotionOverride: s.reduceMotionOverride,
});

export const usePreferencesStore = create<PreferencesStoreState>((set, get) => ({
  ...DEFAULTS,
  isHydrated: false,

  setReduceHaptics: (value) => {
    set({ reduceHaptics: value });
    persist(snapshot(get()));
  },

  setReduceMotionOverride: (value) => {
    set({ reduceMotionOverride: value });
    persist(snapshot(get()));
  },

  loadFromStorage: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        set({ isHydrated: true });
        return;
      }
      const saved = JSON.parse(raw) as Partial<AppearancePreferences>;
      // Merge over defaults so a stored blob missing a future key still
      // resolves to a sane, fully-typed value.
      set({ ...DEFAULTS, ...saved, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },
}));

// Self-hydrate on first import. `haptics` and `useReducedMotion` both pull this
// store before any screen mounts, so there is no natural boot hook to hang the
// load on — kick it off here (idempotent via the `isHydrated` guard).
void usePreferencesStore.getState().loadFromStorage();
