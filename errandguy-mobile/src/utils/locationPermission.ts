import { Alert, Linking } from 'react-native';
import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
}

/**
 * Get the device's current position ROBUSTLY.
 *
 * `Location.getCurrentPositionAsync()` has no built-in timeout — on weak GPS,
 * indoors, or an iOS Simulator with no location set, it can hang indefinitely,
 * which is exactly the "location isn't working / spinner forever" symptom.
 *
 * This helper:
 *   1. Ensures permission first (with the Settings deep-link fallback).
 *   2. Immediately tries the LAST KNOWN position (near-instant) as a seed.
 *   3. Races a fresh high-accuracy fix against a timeout, and if the fix
 *      doesn't arrive in time, falls back to the last-known position instead
 *      of hanging.
 *
 * @returns coordinates, or null if permission denied or no fix at all.
 */
export async function getCurrentCoords(opts?: {
  feature?: string;
  timeoutMs?: number;
  accuracy?: Location.LocationAccuracy;
  requirePermission?: boolean;
}): Promise<Coords | null> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const accuracy = opts?.accuracy ?? Location.Accuracy.Balanced;

  if (opts?.requirePermission !== false) {
    const ok = await ensureLocationPermission({ feature: opts?.feature });
    if (!ok) return null;
  } else {
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== 'granted') return null;
  }

  const toCoords = (p: Location.LocationObject): Coords => ({
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy,
    heading: p.coords.heading != null && p.coords.heading >= 0 ? p.coords.heading : null,
    speed: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed : null,
  });

  // Fast seed from the OS cache — often instant.
  const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);

  const fresh = await new Promise<Location.LocationObject | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, timeoutMs);
    Location.getCurrentPositionAsync({ accuracy })
      .then((p) => { if (!settled) { settled = true; clearTimeout(timer); resolve(p); } })
      .catch(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } });
  });

  const chosen = fresh ?? lastKnown;
  return chosen ? toCoords(chosen) : null;
}

/**
 * Request foreground location permission the RIGHT way.
 *
 * expo-location's `requestForegroundPermissionsAsync()` only shows the native
 * OS dialog the FIRST time. Once the user has denied it (or skipped during
 * onboarding), every later call resolves to `denied` WITHOUT prompting — so a
 * naive `if (status !== 'granted') return` leaves the user permanently stuck
 * with no way to turn GPS on. That is the "I can't enable location" bug.
 *
 * This helper handles the whole lifecycle:
 *   1. Already granted            → returns true immediately.
 *   2. Can still ask              → shows the OS dialog, returns the result.
 *   3. Denied & can't ask again   → shows an alert that deep-links into the
 *                                    app's system Settings page, where the
 *                                    user can flip Location on manually.
 *
 * @param opts.feature short human label for the alert copy, e.g. "find nearby runners".
 * @returns true if permission is granted by the time we return, else false.
 */
export async function ensureLocationPermission(opts?: {
  feature?: string;
}): Promise<boolean> {
  const feature = opts?.feature ?? 'use your location';

  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === 'granted') return true;

  // The OS will still show the dialog — ask.
  if (current.canAskAgain) {
    const res = await Location.requestForegroundPermissionsAsync();
    if (res.status === 'granted') return true;
    if (res.canAskAgain) return false; // user tapped "Don't allow" this once
  }

  // Permanently denied — the only path to grant is the Settings app.
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Location is turned off',
      `ErrandGuy needs location access to ${feature}. Turn it on in Settings to continue.`,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Open Settings',
          onPress: async () => {
            await Linking.openSettings();
            // We can't know synchronously whether they granted it in
            // Settings; the caller should re-check on AppState 'active'.
            resolve(false);
          },
        },
      ],
    );
  });
}
