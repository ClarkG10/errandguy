import { CacheTTL } from './cache.service';

const HERE_API_KEY = process.env.EXPO_PUBLIC_HERE_API_KEY ?? '';

// Never log any portion of the key, even truncated (MARCH-5). Surface only a
// missing-key diagnostic, and only in dev.
if (!HERE_API_KEY && __DEV__) {
  console.error('[route] EXPO_PUBLIC_HERE_API_KEY is EMPTY — routes will not load.');
}

export interface RouteResult {
  /** Polyline coordinates as `[lng, lat]` pairs in route order. */
  coordinates: [number, number][];
  /** Driving distance in metres. */
  distanceMeters: number;
  /** Estimated driving duration in seconds. */
  durationSeconds: number;
}

export interface NavigationStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  maneuverType: string;
  maneuverModifier: string | null;
  /** [lng, lat] point where the maneuver happens. */
  location: [number, number];
  /** Polyline geometry of just this step. */
  geometry: [number, number][];
  bearingAfter: number | null;
}

export interface NavigationRoute extends RouteResult {
  steps: NavigationStep[];
}

// ---------------------------------------------------------------------------
// HERE Flexible Polyline decoder
// Ref: https://github.com/heremaps/flexible-polyline
// ---------------------------------------------------------------------------

// Decoding table: index = (charCode - 45), value = 6-bit integer (-1 = invalid)
const FLEX_DEC: number[] = (() => {
  const t = new Array(128).fill(-1);
  t[45]  = 62; // '-'
  t[95]  = 63; // '_'
  for (let c = 48; c <= 57; c++) t[c] = c - 48 + 52;  // '0'-'9' -> 52-61
  for (let c = 65; c <= 90; c++) t[c] = c - 65;        // 'A'-'Z' -> 0-25
  for (let c = 97; c <= 122; c++) t[c] = c - 97 + 26;  // 'a'-'z' -> 26-51
  return t;
})();

function flexDecodeUnsigned(s: string, i: number): [number, number] {
  let result = 0, shift = 0;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    const v = code < FLEX_DEC.length ? FLEX_DEC[code] : -1;
    if (v < 0) throw new Error(`flexpolyline: invalid char '${s[i]}' at ${i}`);
    result |= (v & 0x1f) << shift;
    i++;
    if ((v & 0x20) === 0) break; // last chunk
    shift += 5;
  }
  return [result, i];
}

// HERE flexible-polyline format version (always 1).
const FLEX_FORMAT_VERSION = 1;

function flexDecodeFlexPolyline(encoded: string): [number, number][] {
  let i = 0;
  // Read version byte first — the spec prepends a version integer before the
  // precision/thirdDim header. The HERE Router v8 API always emits version 1
  // ('B' in the encoding table). Without this read the decoder incorrectly
  // uses the version char as the header and gets precision=1/factor=10, which
  // produces coordinates that are 100 000x off — MapLibre silently drops the
  // layer and the polyline never appears.
  let [version, vi] = flexDecodeUnsigned(encoded, i);
  i = vi;
  if (version !== FLEX_FORMAT_VERSION) {
    throw new Error(`flexpolyline: unsupported version ${version}`);
  }
  // Read header (precision / third-dim type / third-dim precision)
  let [header, ni] = flexDecodeUnsigned(encoded, i);
  i = ni;
  const precision2d = header & 0xf;
  const thirdDim = (header >> 4) & 0x7;
  const precision3d = (header >> 7) & 0xf;
  const factor2d = Math.pow(10, precision2d);
  const factor3d = thirdDim > 0 ? Math.pow(10, precision3d) : 1;

  const coords: [number, number][] = [];
  let lat = 0, lng = 0, z = 0;

  while (i < encoded.length) {
    let val: number;
    [val, i] = flexDecodeUnsigned(encoded, i);
    lat += (val & 1) ? ~(val >> 1) : val >> 1;

    [val, i] = flexDecodeUnsigned(encoded, i);
    lng += (val & 1) ? ~(val >> 1) : val >> 1;

    if (thirdDim > 0) {
      [val, i] = flexDecodeUnsigned(encoded, i);
      z += (val & 1) ? ~(val >> 1) : val >> 1;
      void (z / factor3d); // unused but consumed
    }
    // HERE decodes lat first then lng; return as [lng, lat] for GeoJSON/MapLibre
    coords.push([lng / factor2d, lat / factor2d]);
  }
  return coords;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quantize(n: unknown, digits = 4): string {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : 'NaN';
}

/**
 * Cache key for one leg. A LIVE origin (the runner's moving position) is
 * snapped to 3 decimals (~110 m), the same snap every live caller (useEta, the
 * runner map, customer tracking) uses to decide when to refetch. At 4
 * decimals the key moved with every ~11 m of GPS drift, so the map, its ETA
 * badge and the step hero all missed each other's entry for the same leg and
 * each paid for its own HERE call. A fixed pin (a pickup the customer placed,
 * every destination) keeps the finer snap: two different pins a block apart
 * must never share a route, or the line starts away from the marker.
 */
function routeKey(
  profile: DirectionsProfile,
  fLng: number,
  fLat: number,
  tLng: number,
  tLat: number,
  liveOrigin = false,
): string {
  const o = liveOrigin ? 3 : 4;
  return `route5:${profile}:${liveOrigin ? 'live:' : ''}${quantize(fLng, o)},${quantize(fLat, o)}:${quantize(tLng)},${quantize(tLat)}`;
}

/** `liveOrigin`: the origin is a moving runner, not a pin (see routeKey). */
export interface RouteOptions {
  liveOrigin?: boolean;
}

/**
 * Route results live in memory only. They used to be written to AsyncStorage,
 * but a key carries the runner's position, so almost none was ever read twice
 * and expired entries were only removed when their own key was read again —
 * the store grew for the life of the install, and Android caps it at 6 MB,
 * after which every write in the app fails silently. A route is cheap to
 * refetch after a cold start; small and recent is all this cache needs to be.
 */
const ROUTE_CACHE_MAX = 40;
const routeCache = new Map<string, { value: RouteResult; expiresAt: number }>();

function readRoute(key: string): RouteResult | null {
  const hit = routeCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    routeCache.delete(key);
    return null;
  }
  // Re-insert so the Map's insertion order doubles as recency (LRU).
  routeCache.delete(key);
  routeCache.set(key, hit);
  return hit.value;
}

function writeRoute(key: string, value: RouteResult): void {
  routeCache.delete(key);
  routeCache.set(key, { value, expiresAt: Date.now() + CacheTTL.LONG });
  while (routeCache.size > ROUTE_CACHE_MAX) {
    const oldest = routeCache.keys().next().value;
    if (oldest === undefined) break;
    routeCache.delete(oldest);
  }
}

/**
 * One request per leg at a time. On the runner's errand screen the map, its
 * ETA badge and the step hero all ask for the same leg in the same commit;
 * without this each started its own HERE call before any had landed in the
 * cache. Same idiom as the `inflight` map in api.ts.
 */
const routeInflight = new Map<string, Promise<RouteResult | null>>();

/** Test hook: forget every cached and in-flight route. */
export function __resetRouteCacheForTests(): void {
  routeCache.clear();
  routeInflight.clear();
}

function isFiniteCoord(n: unknown): n is number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v);
}

export type DirectionsProfile = 'driving' | 'cycling' | 'walking';

const HERE_TRANSPORT_MODE: Record<DirectionsProfile, string> = {
  driving: 'car',
  cycling: 'bicycle',
  walking: 'pedestrian',
};

// ---------------------------------------------------------------------------
// ETA model — FALLBACK ONLY, and the single source of truth for it
// ---------------------------------------------------------------------------

/**
 * Average effective city speeds (km/h) per booking vehicle key.
 *
 * IMPORTANT: this table is a FALLBACK. Whenever a real route has been
 * fetched (`getRoute().durationSeconds`), that duration wins — it carries
 * actual road geometry and HERE's traffic model, while this table divides a
 * straight-line/server Haversine distance by a guess. The table exists only
 * for the moments a route isn't available: no HERE key, a failed/absent
 * routing call, or a fare estimate rendered before any route is fetched.
 *
 * It lived duplicated in three places (book/details.tsx, two copies in
 * book/review.tsx) with identical numbers; keeping one copy here means an
 * adjustment can't drift between screens. Never feed these minutes into
 * pricing — `distance_km` stays the only pricing input.
 */
export const VEHICLE_SPEED_KMH: Record<string, number> = {
  walk: 5,
  bicycle: 15,
  motorcycle: 35,
  car: 30,
};

/** Speed used when the vehicle key is unknown (matches the old `?? 30`). */
export const DEFAULT_SPEED_KMH = 30;

/** Same table expressed over routing profiles, for `useEta`'s fallback. */
const PROFILE_SPEED_KMH: Record<DirectionsProfile, number> = {
  walking: VEHICLE_SPEED_KMH.walk,
  cycling: VEHICLE_SPEED_KMH.bicycle,
  driving: DEFAULT_SPEED_KMH,
};

/** Booking vehicle key → the routing profile HERE should be asked for. */
export function profileForVehicle(vehicleType?: string | null): DirectionsProfile {
  switch (vehicleType) {
    case 'walk':
      return 'walking';
    case 'bicycle':
      return 'cycling';
    default:
      return 'driving';
  }
}

/**
 * Fallback ETA in whole minutes from a distance in km. Returns null when the
 * distance isn't a usable number, so callers can hide the ETA rather than
 * print a fabricated "0 min". May return 0 — `formatEtaMinutes` renders that
 * as "< 1 min".
 */
export function etaMinutesFromDistanceKm(
  distanceKm: number | null | undefined,
  vehicleType?: string | null,
): number | null {
  // Guard null/undefined BEFORE coercing: Number(null) is 0, which is finite,
  // so a missing distance would otherwise render a confident "< 1 min".
  if (distanceKm == null) return null;
  const km = typeof distanceKm === 'number' ? distanceKm : Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) return null;
  const speed =
    (vehicleType ? VEHICLE_SPEED_KMH[vehicleType] : undefined) ?? DEFAULT_SPEED_KMH;
  return Math.round((km / speed) * 60);
}

/** Fallback ETA in whole minutes from a distance in metres + routing profile. */
export function etaMinutesFromDistanceMeters(
  distanceMeters: number | null | undefined,
  profile: DirectionsProfile = 'driving',
): number | null {
  // Same null-before-coerce guard as above (Number(null) === 0).
  if (distanceMeters == null) return null;
  const m = typeof distanceMeters === 'number' ? distanceMeters : Number(distanceMeters);
  if (!Number.isFinite(m) || m < 0) return null;
  const speed = PROFILE_SPEED_KMH[profile] ?? DEFAULT_SPEED_KMH;
  return Math.round((m / 1000 / speed) * 60);
}

/**
 * Shared "~Z min" rendering so every surface phrases an ETA identically.
 * Null in → null out (nothing to show).
 */
export function formatEtaMinutes(minutes: number | null | undefined): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return null;
  if (minutes < 1) return '< 1 min';
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes} min`;
}

// ---------------------------------------------------------------------------
// HERE Routing API v8
// ---------------------------------------------------------------------------

interface HereRouteRaw {
  coords: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  steps?: NavigationStep[];
}

async function fetchHereRoute(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
  profile: DirectionsProfile,
  withSteps: boolean,
): Promise<HereRouteRaw | null> {
  if (!HERE_API_KEY) return null;
  const mode = HERE_TRANSPORT_MODE[profile];
  const returnFields = withSteps ? 'polyline,summary,actions,instructions' : 'polyline,summary';
  const url =
    `https://router.hereapi.com/v8/routes` +
    `?origin=${from.lat},${from.lng}` +
    `&destination=${to.lat},${to.lng}` +
    `&transportMode=${mode}` +
    `&return=${returnFields}` +
    `&apiKey=${HERE_API_KEY}`;
  if (__DEV__) console.log(`[route] Fetching: (${from.lat},${from.lng}) → (${to.lat},${to.lng}) [${mode}]`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[route] HTTP error: ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (data.status) {
    // HERE error responses include a "status" field with the HTTP code
    console.error(`[route] API error:`, data.title ?? data.status, data.cause ?? '');
    return null;
  }
  const section = data.routes?.[0]?.sections?.[0];
  if (!section?.polyline) {
    console.warn('[route] No route section or polyline in response');
    return null;
  }

  let coords: [number, number][];
  try {
    coords = flexDecodeFlexPolyline(section.polyline);
  } catch (decodeErr) {
    console.error('[route] Polyline decode error:', decodeErr);
    return null;
  }

  const summary = section.summary ?? {};
  const distanceMeters: number = summary.length ?? 0;
  const durationSeconds: number = summary.duration ?? 0;
  if (__DEV__) console.log(`[route] ✓ ${coords.length} points, ${distanceMeters}m, ${durationSeconds}s`);

  if (!withSteps) {
    return { coords, distanceMeters, durationSeconds };
  }

  const actions: any[] = section.actions ?? [];
  const steps: NavigationStep[] = actions.map((action, idx) => {
    const startOff: number = action.offset ?? 0;
    const endOff: number = actions[idx + 1]?.offset ?? coords.length;
    const stepGeometry = coords.slice(startOff, endOff);
    const location: [number, number] = coords[startOff] ?? [from.lng, from.lat];
    return {
      instruction: action.instruction ?? '',
      distanceMeters: action.length ?? 0,
      durationSeconds: action.duration ?? 0,
      maneuverType: action.action ?? 'continue',
      maneuverModifier: action.direction ?? null,
      location,
      geometry: stepGeometry,
      bearingAfter: null,
    } satisfies NavigationStep;
  });

  return { coords, distanceMeters, durationSeconds, steps };
}

// ---------------------------------------------------------------------------
// Public service
// ---------------------------------------------------------------------------

export const routeService = {
  async getRoute(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    profile: DirectionsProfile = 'driving',
    opts: RouteOptions = {},
  ): Promise<RouteResult | null> {
    const fLng = Number(from?.lng), fLat = Number(from?.lat);
    const tLng = Number(to?.lng),   tLat = Number(to?.lat);
    if (!isFiniteCoord(fLng) || !isFiniteCoord(fLat) || !isFiniteCoord(tLng) || !isFiniteCoord(tLat)) {
      if (__DEV__) console.warn('[route.getRoute] Invalid coordinates:', { from, to });
      return null;
    }
    const key = routeKey(profile, fLng, fLat, tLng, tLat, opts.liveOrigin);
    const cached = readRoute(key);
    if (cached) return cached;
    const pending = routeInflight.get(key);
    if (pending) return pending;

    const request = (async (): Promise<RouteResult | null> => {
      try {
        const r = await fetchHereRoute({ lng: fLng, lat: fLat }, { lng: tLng, lat: tLat }, profile, false);
        if (!r) throw new Error('here_routing_failed');
        const result: RouteResult = {
          coordinates: r.coords,
          distanceMeters: r.distanceMeters,
          durationSeconds: r.durationSeconds,
        };
        // Failures are never cached, so the next caller retries.
        writeRoute(key, result);
        return result;
      } catch (err) {
        console.error('[route.getRoute] Failed:', err);
        return null;
      } finally {
        routeInflight.delete(key);
      }
    })();
    routeInflight.set(key, request);
    return request;
  },

  /**
   * Travel time for a leg in whole minutes, preferring the REAL fetched route
   * duration (road geometry + HERE's traffic model) and only falling back to
   * the straight-line speed table when routing is unavailable.
   *
   * `fallbackDistanceKm` is the straight-line distance the caller already has
   * (e.g. the fare estimate's `distance_km`); pass it so a routing outage
   * degrades to today's approximation instead of showing nothing.
   *
   * Display-only — never feed the result into pricing.
   */
  async getEtaMinutes(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    vehicleType?: string | null,
    fallbackDistanceKm?: number | null,
  ): Promise<number | null> {
    const route = await this.getRoute(from, to, profileForVehicle(vehicleType));
    if (route && Number.isFinite(route.durationSeconds) && route.durationSeconds > 0) {
      return Math.round(route.durationSeconds / 60);
    }
    return etaMinutesFromDistanceKm(fallbackDistanceKm, vehicleType);
  },

  async refreshRoute(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    profile: DirectionsProfile = 'driving',
    opts: RouteOptions = {},
  ): Promise<RouteResult | null> {
    const fLng = Number(from?.lng), fLat = Number(from?.lat);
    const tLng = Number(to?.lng),   tLat = Number(to?.lat);
    if (!isFiniteCoord(fLng) || !isFiniteCoord(fLat) || !isFiniteCoord(tLng) || !isFiniteCoord(tLat)) return null;
    routeCache.delete(routeKey(profile, fLng, fLat, tLng, tLat, opts.liveOrigin));
    return this.getRoute(from, to, profile, opts);
  },

  async getNavigationRoute(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    profile: DirectionsProfile = 'driving',
  ): Promise<NavigationRoute | null> {
    const fLng = Number(from?.lng), fLat = Number(from?.lat);
    const tLng = Number(to?.lng),   tLat = Number(to?.lat);
    if (!isFiniteCoord(fLng) || !isFiniteCoord(fLat) || !isFiniteCoord(tLng) || !isFiniteCoord(tLat)) {
      if (__DEV__) console.warn('[route.getNavigationRoute] Invalid coordinates:', { from, to });
      return null;
    }
    try {
      const r = await fetchHereRoute({ lng: fLng, lat: fLat }, { lng: tLng, lat: tLat }, profile, true);
      if (!r || !r.steps) {
        console.error('[route.getNavigationRoute] No result from HERE Routing');
        return null;
      }
      return { coordinates: r.coords, distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds, steps: r.steps };
    } catch (err) {
      console.error('[route.getNavigationRoute] Error:', err);
      return null;
    }
  },
};
