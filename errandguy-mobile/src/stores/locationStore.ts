import { create } from 'zustand';
import * as Location from 'expo-location';
import { runnerService } from '../services/runner.service';
import type { Coordinate, RunnerLocation } from '../types';

interface LocationState {
  currentLocation: Coordinate | null;
  runnerLocation: RunnerLocation | null;
  watchId: Location.LocationSubscription | null;
  isTracking: boolean;

  setCurrentLocation: (location: Coordinate | null) => void;
  setRunnerLocation: (location: RunnerLocation | null) => void;
  startTracking: () => Promise<boolean>;
  stopTracking: () => void;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  currentLocation: null,
  runnerLocation: null,
  watchId: null,
  isTracking: false,

  setCurrentLocation: (location) => set({ currentLocation: location }),

  setRunnerLocation: (location) => set({ runnerLocation: location }),

  startTracking: async () => {
    // Defensive: if a previous watcher is still alive (e.g. re-mount of
    // the runner home after a quick navigation), tear it down first so we
    // never leak duplicate subscriptions that would double-send GPS to
    // the backend and double-charge our rate limit.
    const existing = get().watchId;
    if (existing) {
      existing.remove();
      set({ watchId: null, isTracking: false });
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      // Caller (e.g. runner home toggle) needs to know permission was
      // denied so it can show an actionable toast — otherwise the
      // runner appears Online but never emits GPS and the customer
      // tracking screen sits empty.
      set({ isTracking: false });
      return false;
    }

    // Last successfully reported location — used to suppress jittery
    // sub-meter updates that some Android devices emit while stationary.
    let lastSent: { lat: number; lng: number; t: number } | null = null;

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 10,
        // Server throttles /runner/location to 1/5s. Watching at exactly
        // 5000ms races the throttle and produces sporadic 429s on every
        // 6th-or-so tick. 6000ms gives a 1s safety margin and matches
        // what the customer-side polling fallback expects to see.
        timeInterval: 6000,
      },
      (location) => {
        // Drop low-confidence fixes (urban canyons, indoor wifi-only)
        // so the customer's tracking pin doesn't teleport.
        const acc = location.coords.accuracy;
        if (typeof acc === 'number' && acc > 75) return;

        const rawHeading = location.coords.heading;
        const rawSpeed = location.coords.speed;
        const coords = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          // iOS/Android emit -1 when heading/speed are unknown; treat
          // those as "no data" instead of forwarding nonsense to the API.
          heading:
            typeof rawHeading === 'number' && rawHeading >= 0 ? rawHeading : undefined,
          speed: typeof rawSpeed === 'number' && rawSpeed >= 0 ? rawSpeed : undefined,
        };

        // Heartbeat: always send if 30s have passed since the last push,
        // even if the runner hasn't moved — gives the customer fresh
        // "updated 12s ago" copy and confirms the runner is still online.
        const now = Date.now();
        if (lastSent) {
          // Equirectangular distance in metres. The previous version
          // compared raw degree deltas with `Math.hypot(dLat, dLng) > 0.00007`,
          // which is latitude-dependent — at Manila's ~14°N a degree of
          // longitude is ~108 km, so 0.00007° ≈ 7.5 m, but at higher
          // latitudes the same threshold would silently drop perfectly
          // valid 10m moves. Convert to actual metres so the threshold
          // means what it claims regardless of where the runner is.
          const dLatM = (coords.lat - lastSent.lat) * 111_000;
          const dLngM =
            (coords.lng - lastSent.lng) *
            111_000 *
            Math.cos((lastSent.lat * Math.PI) / 180);
          const movedMeters = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
          if (movedMeters < 8 && now - lastSent.t < 30_000) return;
        }
        lastSent = { lat: coords.lat, lng: coords.lng, t: now };

        set({
          currentLocation: { lat: coords.lat, lng: coords.lng },
        });
        // Send location to backend so customer can track runner in realtime.
        runnerService.updateLocation(coords).catch(() => {
          // Network drop — keep the watcher alive; the next valid fix
          // will retry. Resetting `lastSent` would just spam the queue.
        });
      },
    );

    set({ watchId: subscription, isTracking: true });
    return true;
  },

  stopTracking: () => {
    const { watchId } = get();
    if (watchId) {
      watchId.remove();
    }
    set({ watchId: null, isTracking: false });
  },
}));
