import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Persisted marker of the last runtime version whose "What's New" the user has
 *  already seen. Read/written by <WhatsNewSheet/> to fire the changelog once per
 *  release. Hand-rolled AsyncStorage (no persist middleware) to match the rest
 *  of the store layer (bookingStore / paymentStore). */
const LAST_SEEN_VERSION_KEY = '@whats_new_last_seen_version';

/**
 * OTA update lifecycle state, driven by useOtaUpdate. The global
 * <OtaUpdateGate/> (mounted in the root layout) reacts to `isMandatory` +
 * `status` to force a critical update; settings rows read `status` for the
 * "Check for updates" affordance.
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'downloaded'
  | 'upToDate'
  | 'error';

interface UpdateStore {
  status: UpdateStatus;
  isMandatory: boolean;
  lastCheckedAt: number | null;
  /** Runtime version whose "What's New" the user has already dismissed.
   *  `null` until hydrated from storage (see `whatsNewHydrated`). */
  lastSeenVersion: string | null;
  /** Flips true once `loadLastSeenVersion()` has read storage, so the
   *  changelog gate doesn't fire against a not-yet-loaded (null) value. */
  whatsNewHydrated: boolean;
  set: (partial: Partial<Pick<UpdateStore, 'status' | 'isMandatory' | 'lastCheckedAt'>>) => void;
  /** Hydrate `lastSeenVersion` from AsyncStorage. Idempotent. */
  loadLastSeenVersion: () => Promise<void>;
  /** Record `version` as seen (in-memory + persisted). */
  setLastSeenVersion: (version: string) => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  status: 'idle',
  isMandatory: false,
  lastCheckedAt: null,
  lastSeenVersion: null,
  whatsNewHydrated: false,
  set: (partial) => set(partial),
  loadLastSeenVersion: async () => {
    try {
      const stored = await AsyncStorage.getItem(LAST_SEEN_VERSION_KEY);
      set({ lastSeenVersion: stored ?? null, whatsNewHydrated: true });
    } catch {
      // Storage read failure is non-fatal — treat as "never seen" but still
      // mark hydrated so the gate can make its (conservative) decision.
      set({ whatsNewHydrated: true });
    }
  },
  setLastSeenVersion: (version) => {
    set({ lastSeenVersion: version });
    AsyncStorage.setItem(LAST_SEEN_VERSION_KEY, version).catch(() => {});
  },
  reset: () => set({ status: 'idle', isMandatory: false }),
}));

/** Non-hook accessor for use outside React (mirrors toast/network stores). */
export const updates = {
  get: () => useUpdateStore.getState(),
  set: (partial: Parameters<UpdateStore['set']>[0]) => useUpdateStore.getState().set(partial),
};
