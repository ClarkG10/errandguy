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
  startTracking: () => Promise<void>;
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
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 10,
        timeInterval: 5000,
      },
      (location) => {
        const coords = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          heading: location.coords.heading ?? undefined,
          speed: location.coords.speed ?? undefined,
        };
        set({
          currentLocation: {
            lat: coords.lat,
            lng: coords.lng,
          },
        });
        // Send location to backend so customer can track runner in realtime
        runnerService.updateLocation(coords).catch(() => {});
      },
    );

    set({ watchId: subscription, isTracking: true });
  },

  stopTracking: () => {
    const { watchId } = get();
    if (watchId) {
      watchId.remove();
    }
    set({ watchId: null, isTracking: false });
  },
}));
