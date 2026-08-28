import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * External turn-by-turn handoff.
 *
 * The in-app Navigate screen owns the primary routing experience, but PH
 * runners overwhelmingly drive with Waze (and some prefer the OS maps app for
 * traffic / alternate routes). Before this helper the only external option was
 * Apple/Google Maps, so a Waze driver had to copy coordinates by hand — which
 * defeats the whole "one tap to the next waypoint" promise.
 *
 * Pure URL builders live here (unit-testable, no RN surface) with a thin
 * `openExternalNav` wrapper that does the canOpenURL → web-fallback dance.
 */

export type ExternalNavApp = 'waze' | 'maps';

/** AsyncStorage key holding the runner's last external-nav choice. */
export const EXTERNAL_NAV_PREF_KEY = 'runner_external_nav_app';

/** Narrow an arbitrary coordinate pair to finite numbers, or null. */
export function normalizeCoords(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined,
): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;
  // Out-of-range coordinates would produce a URL that silently drops the
  // driver at the wrong place — better to report "no coordinates".
  if (Math.abs(nLat) > 90 || Math.abs(nLng) > 180) return null;
  return { lat: nLat, lng: nLng };
}

/** Trim float noise so the URL stays short (6dp ≈ 11cm — plenty). */
function fmt(n: number): string {
  return String(Number(n.toFixed(6)));
}

/** `waze://` deep link — opens the installed app straight into navigation. */
export function buildWazeAppUrl(lat: number, lng: number): string {
  return `waze://?ll=${fmt(lat)},${fmt(lng)}&navigate=yes`;
}

/**
 * Universal-link fallback. On a device WITHOUT Waze this lands on the Waze
 * web page (which offers the store); on a device WITH Waze the OS hands it
 * straight to the app.
 */
export function buildWazeWebUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${fmt(lat)},${fmt(lng)}&navigate=yes`;
}

/**
 * System maps deep link — unchanged from the URLs the errand screen has always
 * used (Apple Maps on iOS, the Google Maps web intent everywhere else).
 */
export function buildSystemMapsUrl(
  lat: number,
  lng: number,
  os: string = Platform.OS,
): string {
  return os === 'ios'
    ? `http://maps.apple.com/?daddr=${fmt(lat)},${fmt(lng)}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${fmt(lat)},${fmt(
        lng,
      )}&travelmode=driving`;
}

/**
 * Open the chosen external navigation app at `lat,lng`.
 *
 * Waze is tried as a deep link first and falls back to the universal link when
 * the app isn't installed (iOS `canOpenURL` also returns false when `waze` is
 * missing from LSApplicationQueriesSchemes, so the fallback covers that build
 * gap too). Resolves `false` when nothing could be opened, letting the caller
 * surface a toast instead of failing silently.
 */
export async function openExternalNav(
  app: ExternalNavApp,
  lat: number,
  lng: number,
): Promise<boolean> {
  const candidates =
    app === 'waze'
      ? [buildWazeAppUrl(lat, lng), buildWazeWebUrl(lat, lng)]
      : [buildSystemMapsUrl(lat, lng)];

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    const isLast = i === candidates.length - 1;
    try {
      // Only gate the non-final candidates on canOpenURL — the final URL is an
      // https link every platform can open, and canOpenURL is unreliable
      // enough (undeclared schemes) that gating it would strand the runner.
      if (!isLast) {
        const supported = await Linking.canOpenURL(url).catch(() => false);
        if (!supported) continue;
      }
      await Linking.openURL(url);
      return true;
    } catch {
      if (isLast) return false;
    }
  }
  return false;
}

/** Read the runner's remembered choice, or null when they've never picked. */
export async function getPreferredNavApp(): Promise<ExternalNavApp | null> {
  try {
    const v = await AsyncStorage.getItem(EXTERNAL_NAV_PREF_KEY);
    return v === 'waze' || v === 'maps' ? v : null;
  } catch {
    return null;
  }
}

/** Remember the runner's choice so the next handoff is a single tap. */
export async function setPreferredNavApp(app: ExternalNavApp): Promise<void> {
  try {
    await AsyncStorage.setItem(EXTERNAL_NAV_PREF_KEY, app);
  } catch {
    // A failed preference write is not worth interrupting a drive over.
  }
}
