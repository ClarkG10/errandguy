import { create } from 'zustand';

/**
 * Dep-free offline detection (no netinfo / expo-network installed).
 *
 * Connectivity is inferred from real API traffic via the api.ts
 * interceptors:
 *   - an axios error with NO response (true network error) → offline
 *   - ANY response from the server (success or HTTP error) → online
 *
 * While offline, <OfflineBanner /> pings a cheap health endpoint every
 * ~10s in the foreground so the flag auto-recovers without the user
 * having to trigger a request themselves.
 */
interface NetworkStore {
  /** True after a request failed at the transport layer (no response). */
  isOffline: boolean;
  /** Epoch ms of the last offline/online transition; null until the
   *  first transition. */
  lastChangedAt: number | null;
  setOffline: (offline: boolean) => void;
}

export const useNetworkStore = create<NetworkStore>((set) => ({
  isOffline: false,
  lastChangedAt: null,
  setOffline: (offline) =>
    set((s) =>
      // No-op when unchanged so the (very hot) response interceptor
      // never causes store subscribers to re-render on happy-path calls.
      s.isOffline === offline
        ? s
        : { isOffline: offline, lastChangedAt: Date.now() },
    ),
}));

/** Non-hook accessor for use outside React (api.ts interceptors). */
export const network = {
  setOffline: (offline: boolean) =>
    useNetworkStore.getState().setOffline(offline),
  isOffline: () => useNetworkStore.getState().isOffline,
};
