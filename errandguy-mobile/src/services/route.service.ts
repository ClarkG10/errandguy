import { CacheService, CacheTTL } from './cache.service';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

export interface RouteResult {
  /** Polyline coordinates as `[lng, lat]` pairs in route order. */
  coordinates: [number, number][];
  /** Driving distance in metres. */
  distanceMeters: number;
  /** Estimated driving duration in seconds. */
  durationSeconds: number;
}

/**
 * Decode a Google Maps encoded polyline string into [lng, lat] pairs.
 * Google uses lat,lng order in its encoding — we flip to [lng, lat] so
 * all consumers (react-native-maps Polyline, route matching, etc.) get
 * the same [lng, lat] convention as the old Mapbox implementation.
 */
function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

function quantize(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 'NaN';
  return v.toFixed(4);
}

function isFiniteCoord(n: unknown): n is number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v);
}

/** Google Directions API travel mode mapping */
const GOOGLE_MODE: Record<DirectionsProfile, string> = {
  driving: 'driving',
  cycling: 'bicycling',
  walking: 'walking',
};

export type DirectionsProfile = 'driving' | 'cycling' | 'walking';

/**
 * In-memory route fetcher with persistent (AsyncStorage) cache layer.
 *
 * Design notes:
 * - Routes are deterministic for a given pair of pins (within ~11m), so
 *   we cache them aggressively. Mapbox Directions has a generous free
 *   tier but per-MAU rate limits — repeated mounts of the booking
 *   review or tracking screen would otherwise burn the same call.
 * - Errors are returned, not thrown. The previous call sites all used
 *   `.catch(() => {})` and silently dropped failures, which made
 *   "polyline missing" look like a Mapbox outage when it was actually
 *   a 401/429 from a bad/exhausted token.
 * - We deliberately do NOT auto-retry on 429; that would just compound
 *   the rate-limit situation. Caller decides.
 */
export const routeService = {
  /**
   * Fetch a driving route with cache. Returns `null` only when the
   * request fails (network, invalid key, etc.). Always inspect the
   * return — never assume non-null.
   */
  async getRoute(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    profile: DirectionsProfile = 'driving',
  ): Promise<RouteResult | null> {
    if (!GOOGLE_MAPS_KEY) return null;
    const fLng = Number(from?.lng);
    const fLat = Number(from?.lat);
    const tLng = Number(to?.lng);
    const tLat = Number(to?.lat);
    if (
      !isFiniteCoord(fLng) ||
      !isFiniteCoord(fLat) ||
      !isFiniteCoord(tLng) ||
      !isFiniteCoord(tLat)
    ) {
      return null;
    }

    const key = `route:${profile}:${quantize(fLng)},${quantize(fLat)}:${quantize(tLng)},${quantize(tLat)}`;
    try {
      return await CacheService.getOrFetch<RouteResult>(
        key,
        async () => {
          const mode = GOOGLE_MODE[profile];
          const url =
            `https://maps.googleapis.com/maps/api/directions/json` +
            `?origin=${fLat},${fLng}` +
            `&destination=${tLat},${tLng}` +
            `&mode=${mode}` +
            `&region=ph` +
            `&key=${GOOGLE_MAPS_KEY}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`google_directions_${res.status}`);
          const data = await res.json();
          if (data.status !== 'OK') throw new Error(`google_directions_${data.status}`);
          const leg = data.routes?.[0]?.legs?.[0];
          const polyline = data.routes?.[0]?.overview_polyline?.points;
          if (!polyline || !leg) throw new Error('google_directions_empty');
          return {
            coordinates: decodePolyline(polyline),
            distanceMeters: leg.distance?.value ?? 0,
            durationSeconds: leg.duration?.value ?? 0,
          };
        },
        CacheTTL.LONG,
      );
    } catch {
      return null;
    }
  },

  /** Bypass cache and force a fresh fetch (used by retry buttons). */
  async refreshRoute(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    profile: DirectionsProfile = 'driving',
  ): Promise<RouteResult | null> {
    const fLng = Number(from?.lng);
    const fLat = Number(from?.lat);
    const tLng = Number(to?.lng);
    const tLat = Number(to?.lat);
    if (
      !isFiniteCoord(fLng) ||
      !isFiniteCoord(fLat) ||
      !isFiniteCoord(tLng) ||
      !isFiniteCoord(tLat)
    ) {
      return null;
    }
    const key = `route:${profile}:${quantize(fLng)},${quantize(fLat)}:${quantize(tLng)},${quantize(tLat)}`;
    await CacheService.remove(key);
    return this.getRoute(from, to, profile);
  },

  /**
   * Navigation-grade fetch: returns the polyline + per-step turn-by-turn
   * maneuvers. Used by the runner navigation screen to drive the
   * "in 200 m, turn right onto …" banner.
   *
   * Not cached — the runner's origin moves continuously and stale
   * steps would point at intersections they've already passed.
   */
  async getNavigationRoute(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    profile: DirectionsProfile = 'driving',
  ): Promise<NavigationRoute | null> {
    if (!GOOGLE_MAPS_KEY) return null;
    const fLng = Number(from?.lng);
    const fLat = Number(from?.lat);
    const tLng = Number(to?.lng);
    const tLat = Number(to?.lat);
    if (
      !isFiniteCoord(fLng) ||
      !isFiniteCoord(fLat) ||
      !isFiniteCoord(tLng) ||
      !isFiniteCoord(tLat)
    ) {
      return null;
    }
    try {
      const mode = GOOGLE_MODE[profile];
      const url =
        `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${fLat},${fLng}` +
        `&destination=${tLat},${tLng}` +
        `&mode=${mode}` +
        `&region=ph` +
        `&key=${GOOGLE_MAPS_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status !== 'OK') return null;
      const route = data.routes?.[0];
      const leg = route?.legs?.[0];
      const polyline = route?.overview_polyline?.points;
      if (!polyline || !leg) return null;

      const coords = decodePolyline(polyline);

      const steps: NavigationStep[] = (leg.steps ?? []).map((s: any) => {
        const stepCoords = decodePolyline(s.polyline?.points ?? '');
        const maneuver = s.maneuver ?? '';
        // Google uses combined strings like "turn-right", "turn-left",
        // "roundabout-left". Split at first dash to get type + modifier.
        const dashIdx = maneuver.indexOf('-');
        const maneuverType = dashIdx > 0 ? maneuver.slice(0, dashIdx) : (maneuver || 'continue');
        const maneuverModifier = dashIdx > 0 ? maneuver.slice(dashIdx + 1) : null;
        // Strip HTML from Google's instruction string (<b>, <div>, etc.)
        const instruction = (s.html_instructions ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        const startLat = s.start_location?.lat ?? fLat;
        const startLng = s.start_location?.lng ?? fLng;
        return {
          instruction,
          distanceMeters: s.distance?.value ?? 0,
          durationSeconds: s.duration?.value ?? 0,
          maneuverType,
          maneuverModifier: maneuverModifier ? maneuverModifier.replace(/-/g, ' ') : null,
          location: [startLng, startLat] as [number, number],
          geometry: stepCoords,
          bearingAfter: null, // Google Directions doesn't provide bearing
        } satisfies NavigationStep;
      });

      return {
        coordinates: coords,
        distanceMeters: leg.distance?.value ?? 0,
        durationSeconds: leg.duration?.value ?? 0,
        steps,
      };
    } catch {
      return null;
    }
  },
};
export interface NavigationStep {
  /** Plain English instruction, e.g. "Turn right onto Quezon Ave". */
  instruction: string;
  /** Distance covered by this step in metres. */
  distanceMeters: number;
  /** Estimated time to traverse this step in seconds. */
  durationSeconds: number;
  /** Maneuver type ("turn", "merge", "arrive", …). */
  maneuverType: string;
  /** Modifier ("left", "right", "slight left", …) or null when n/a. */
  maneuverModifier: string | null;
  /** [lng, lat] point where the maneuver happens. */
  location: [number, number];
  /** Polyline geometry of just this step (for off-route detection). */
  geometry: [number, number][];
  /** Compass bearing AFTER the maneuver, 0–359, or null. */
  bearingAfter: number | null;
}

export interface NavigationRoute extends RouteResult {
  steps: NavigationStep[];
}
