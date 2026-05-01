import { useEffect, useMemo, useRef, useState } from 'react';
import { routeService } from '../services/route.service';

export interface EtaResult {
  /** Estimated travel time in minutes (rounded up to ≥1). `null` until first fetch resolves. */
  minutes: number | null;
  /** Straight-line distance to destination in metres (cheap haversine — refreshes per GPS tick). */
  distanceMeters: number | null;
  /** True while a Mapbox Directions fetch is in flight. */
  refreshing: boolean;
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
 * destination, backed by the cached `routeService` and gracefully
 * degrading to a straight-line/30-km/h fallback when Directions is
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
): EtaResult {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
      )
      .then((res) => {
        if (cancelled) return;
        if (res) {
          // Round up — "0 min" feels broken to a customer staring at a
          // pin two streets over.
          setMinutes(Math.max(1, Math.round(res.durationSeconds / 60)));
        } else if (distanceMeters != null) {
          // Fallback: assume ~30 km/h average effective speed in city
          // traffic. Better than showing nothing while we wait for
          // Mapbox to come back.
          setMinutes(Math.max(1, Math.round(distanceMeters / 1000 / 30 * 60)));
        }
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [originKey, destKey, profile]);

  return { minutes, distanceMeters, refreshing };
}
