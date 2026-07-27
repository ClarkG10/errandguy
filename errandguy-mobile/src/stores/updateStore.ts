import { create } from 'zustand';

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
  set: (partial: Partial<Pick<UpdateStore, 'status' | 'isMandatory' | 'lastCheckedAt'>>) => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  status: 'idle',
  isMandatory: false,
  lastCheckedAt: null,
  set: (partial) => set(partial),
  reset: () => set({ status: 'idle', isMandatory: false }),
}));

/** Non-hook accessor for use outside React (mirrors toast/network stores). */
export const updates = {
  get: () => useUpdateStore.getState(),
  set: (partial: Parameters<UpdateStore['set']>[0]) => useUpdateStore.getState().set(partial),
};
