import { create } from 'zustand';

/**
 * Counts in-flight network requests so the UI can render a thin global
 * progress bar (à la YouTube / GitHub) at the top of the screen.
 *
 * The api.ts interceptors call `start()` for each outgoing request and
 * `done()` when the request settles (success or error). The bar
 * disappears when the counter returns to zero.
 *
 * GET requests served from the in-process micro-cache do NOT touch this
 * counter — there's no perceptible work to indicate.
 */
interface ApiActivityStore {
  /** Number of outstanding non-cached requests. */
  count: number;
  start: () => void;
  done: () => void;
  /** Force-reset (e.g. on logout) so a stuck counter doesn't pin the bar. */
  reset: () => void;
}

export const useApiActivityStore = create<ApiActivityStore>((set) => ({
  count: 0,
  start: () => set((s) => ({ count: s.count + 1 })),
  done: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
  reset: () => set({ count: 0 }),
}));

export const apiActivity = {
  start: () => useApiActivityStore.getState().start(),
  done: () => useApiActivityStore.getState().done(),
  reset: () => useApiActivityStore.getState().reset(),
};
