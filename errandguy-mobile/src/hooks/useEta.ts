import { useEffect, useMemo, useRef, useState } from 'react';
import { etaMinutesFromDistanceMeters, routeService } from '../services/route.service';

export interface EtaResult {
  /** Estimated travel time in minutes (rounded up to ≥1). `null` until first fetch resolves. */
  minutes: number | null;
  /** Straight-line distance to destination in metres (cheap haversine — refreshes per GPS tick). */
  distanceMeters: number | null;
  /** True while a Mapbox Directions fetch is in flight. */
  refreshing: boolean;
  /** Geometry of the last fetched route as `[lng, lat]` pairs, or null before
   *  one lands. Lets a map draw the same leg this ETA came from instead of
   *  asking for it a second time. */
  coordinates: [number, number][] | null;
}

interface UseEtaOptions {
  /**
   * When false the hook keeps its last values and fetches nothing — for a
   * screen that stays mounted under another one (the errand cockpit under
   * turn-by-turn). It catches up on the next change once re-enabled.
   */
  enabled?: boolean;
}

interface Point {
  lat: number;
  lng: number;
}

/**
 * Equirectangular distance approximation in metres. Plenty accurate
 * (<0.5% error) up to a few km, which is the only range we care about
 * for "is the runner about to arrive?" gating, and ~5x cheaper than
 * full haversine.
 */
function approxDistanceMeters(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * 111_000;
  const dLng = (b.lng - a.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Round a coordinate to ~111m precision so the route key clusters
 * sub-block movements into the same Mapbox call. Without this the
 * runner's GPS jitter would re-hit Directions every second. Defensive
 * against string inputs (Postgres `numeric` columns serialise as
 * strings unless explicitly cast).
 */
function snap(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 'NaN';
  return v.toFixed(3);
}

function coercePoint(p: Point | null | undefined): Point | null {
  if (!p) return null;
  const lat = typeof p.lat === 'number' ? p.lat : Number(p.lat);
  const lng = typeof p.lng === 'number' ? p.lng : Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Live ETA from a moving origin (typically the runner) to a fixed
 * destination, backed by the cached `routeService`. The fetched route's own
 * duration is always preferred; it degrades to the shared straight-line
 * speed table (profile-aware — see route.service) only when Directions is
 * unavailable.
 *
 * Re-fetches the actual route only when:
 *   - the destination changes, OR
 *   - the origin has moved more than ~110m since the previous fetch,
 *
 * which keeps Mapbox calls in single-digits per minute even with a
 * 1 Hz GPS feed.
 *
 * Pass `null` for either origin/destination to disable.
 */
export function useEta(
  origin: Point | null | undefined,
  destination: Point | null | undefined,
  profile: 'driving' | 'cycling' | 'walking' = 'driving',
  { enabled = true }: UseEtaOptions = {},
): EtaResult {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [coordinates, setCoordinates] = useState<[number, number][] | null>(null);

  // Defensive coercion: callers occasionally pass `booking.pickup_lat`
  // / `booking.pickup_lng` straight through, which Laravel serialises
  // from a Postgres `numeric` column as a string. Normalise once here
  // so every downstream consumer sees a finite Point or null.
  const safeOrigin = useMemo(() => coercePoint(origin), [origin?.lat, origin?.lng]);
  const safeDestination = useMemo(
    () => coercePoint(destination),
    [destination?.lat, destination?.lng],
  );

  const distanceMeters = useMemo(() => {
    if (!safeOrigin || !safeDestination) return null;
    return approxDistanceMeters(safeOrigin, safeDestination);
  }, [safeOrigin, safeDestination]);

  // Snapped origin key drives refetch — destination is fixed per call site.
  const originKey = safeOrigin ? `${snap(safeOrigin.lat)},${snap(safeOrigin.lng)}` : '';
  const destKey = safeDestination
    ? `${snap(safeDestination.lat)},${snap(safeDestination.lng)}`
    : '';
  const lastFetchedKeyRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    if (!safeOrigin || !safeDestination) {
      setMinutes(null);
      return;
    }
    const key = `${originKey}|${destKey}|${profile}`;
    if (key === lastFetchedKeyRef.current) return;
    lastFetchedKeyRef.current = key;

    let cancelled = false;
    setRefreshing(true);
    routeService
      .getRoute(
        { lng: safeOrigin.lng, lat: safeOrigin.lat },
        { lng: safeDestination.lng, lat: safeDestination.lat },
        profile,
        // The origin here is the runner's moving position.
        { liveOrigin: true },
      )
      .then((res) => {
        if (cancelled) return;
        // A failed refetch keeps the last line on the map rather than
        // blanking it, same as the ETA below.
        if (res && res.coordinates.length > 0) setCoordinates(res.coordinates);
        // The REAL fetched route duration always wins — it carries road
        // geometry and HERE's traffic model. The speed table below is a
        // strict fallback for when routing is unavailable.
        if (res && Number.isFinite(res.durationSeconds) && res.durationSeconds > 0) {
          // Round up — "0 min" feels broken to a customer staring at a
          // pin two streets over.
          setMinutes(Math.max(1, Math.round(res.durationSeconds / 60)));
          return;
        }
        if (distanceMeters != null) {
          // Fallback: the shared straight-line speed table, keyed to THIS
          // leg's profile. It used to be a hardcoded 30 km/h regardless of
          // profile, so a walking ETA came back ~6x too optimistic.
          const fallback = etaMinutesFromDistanceMeters(distanceMeters, profile);
          if (fallback != null) setMinutes(Math.max(1, fallback));
        }
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });

    return () => {
      cancelled = true;
      // An effect cut short (disabled, or the origin moved cells mid-fetch)
      // must not leave its key marked as fetched, or re-enabling at the same
      // spot would skip the fetch and keep whatever was there before.
      if (lastFetchedKeyRef.current === key) lastFetchedKeyRef.current = '';
    };
  }, [originKey, destKey, profile, enabled]);

  return { minutes, distanceMeters, refreshing, coordinates };
}
