import { CacheService, CacheTTL } from './cache.service';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

export interface RouteResult {
  /** Polyline coordinates as `[lng, lat]` pairs in route order. */
  coordinates: [number, number][];
  /** Driving distance in metres (Mapbox `routes[0].distance`). */
  distanceMeters: number;
  /** Estimated driving duration in seconds (Mapbox `routes[0].duration`). */
  durationSeconds: number;
}

/**
 * Round a coordinate to ~11m precision so cache keys cluster nearby
 * pickup/dropoff pins. Two requests for "same intersection ± 5m" share
 * one cache hit — Mapbox bills per request, so this matters.
 */
function quantize(n: number): string {
  return n.toFixed(4);
}

function cacheKey(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  profile: string,
): string {
  return `route:${profile}:${quantize(fromLng)},${quantize(fromLat)}:${quantize(toLng)},${quantize(toLat)}`;
}

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
   * request fails (network, 401, 429, malformed token, etc.). Always
   * inspect the return — never assume non-null.
   */
  async getRoute(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    profile: DirectionsProfile = 'driving',
  ): Promise<RouteResult | null> {
    if (!MAPBOX_TOKEN) return null;

    const key = cacheKey(from.lng, from.lat, to.lng, to.lat, profile);
    try {
      // Persist for 6 hours — road geometry doesn't meaningfully change
      // mid-day, and a stale ETA is corrected by realtime once the
      // runner is dispatched.
      return await CacheService.getOrFetch<RouteResult>(
        key,
        async () => {
          const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
          const res = await fetch(url);
          if (!res.ok) {
            // Surface as throw so getOrFetch does NOT cache the failure.
            throw new Error(`mapbox_directions_${res.status}`);
          }
          const data = await res.json();
          const route = data.routes?.[0];
          const coords = route?.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length === 0) {
            throw new Error('mapbox_directions_empty');
          }
          return {
            coordinates: coords as [number, number][],
            distanceMeters: Number(route.distance ?? 0),
            durationSeconds: Number(route.duration ?? 0),
          };
        },
        CacheTTL.LONG, // 30 min
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
    const key = cacheKey(from.lng, from.lat, to.lng, to.lat, profile);
    await CacheService.remove(key);
    return this.getRoute(from, to, profile);
  },
};
