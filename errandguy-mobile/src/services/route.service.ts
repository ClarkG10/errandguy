import { CacheService, CacheTTL } from './cache.service';

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

function quantize(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v.toFixed(4) : 'NaN';
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
  ): Promise<RouteResult | null> {
    const fLng = Number(from?.lng), fLat = Number(from?.lat);
    const tLng = Number(to?.lng),   tLat = Number(to?.lat);
    if (!isFiniteCoord(fLng) || !isFiniteCoord(fLat) || !isFiniteCoord(tLng) || !isFiniteCoord(tLat)) {
      if (__DEV__) console.warn('[route.getRoute] Invalid coordinates:', { from, to });
      return null;
    }
    const key = `route4:${profile}:${quantize(fLng)},${quantize(fLat)}:${quantize(tLng)},${quantize(tLat)}`;
    try {
      return await CacheService.getOrFetch<RouteResult>(
        key,
        async () => {
          const r = await fetchHereRoute({ lng: fLng, lat: fLat }, { lng: tLng, lat: tLat }, profile, false);
          if (!r) throw new Error('here_routing_failed');
          return { coordinates: r.coords, distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds };
        },
        CacheTTL.LONG,
      );
    } catch (err) {
      console.error('[route.getRoute] Failed:', err);
      return null;
    }
  },

  async refreshRoute(
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
    profile: DirectionsProfile = 'driving',
  ): Promise<RouteResult | null> {
    const fLng = Number(from?.lng), fLat = Number(from?.lat);
    const tLng = Number(to?.lng),   tLat = Number(to?.lat);
    if (!isFiniteCoord(fLng) || !isFiniteCoord(fLat) || !isFiniteCoord(tLng) || !isFiniteCoord(tLat)) return null;
    const key = `route4:${profile}:${quantize(fLng)},${quantize(fLat)}:${quantize(tLng)},${quantize(tLat)}`;
    await CacheService.remove(key);
    return this.getRoute(from, to, profile);
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
