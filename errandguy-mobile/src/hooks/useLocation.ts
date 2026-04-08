import { useCallback } from 'react';
import * as Location from 'expo-location';
import { useLocationStore } from '../stores/locationStore';

export function useLocation() {
  const {
    currentLocation,
    isTracking,
    setCurrentLocation,
    startTracking,
    stopTracking,
  } = useLocationStore();

  const requestPermissions = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  }, []);

  const getCurrentPosition = useCallback(async () => {
    const granted = await requestPermissions();
    if (!granted) return null;

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const coords = {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
    };
    setCurrentLocation(coords);
    return coords;
  }, [requestPermissions, setCurrentLocation]);

  return {
    currentLocation,
    isTracking,
    requestPermissions,
    getCurrentPosition,
    startWatching: startTracking,
    stopWatching: stopTracking,
  };
}
