import { getCurrentCoords } from './locationPermission';

/** The phone's position as sent with an SOS (server: lat, lng, accuracy). */
export interface SosCoords {
  lat: number;
  lng: number;
  /** Metres, when the OS reported one. */
  accuracy: number | null;
}

/** The whole lookup — permission check, last-known seed and a fresh fix —
 *  never holds the panic button longer than this. */
export const SOS_LOCATE_BUDGET_MS = 3_000;

const isLatLng = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

/**
 * Where the phone is right now, for an SOS — or null.
 *
 * Deliberately never ASKS for permission: a system dialog in the middle of an
 * emergency is worse than an alert without coordinates, and the server still
 * has the errand's own addresses. A fresh fix is raced against a short budget
 * and the OS's last known position is the fallback, so a phone indoors or in a
 * basement still sends something rather than waiting on a satellite lock.
 */
export async function locateForSos(
  budgetMs: number = SOS_LOCATE_BUDGET_MS,
): Promise<SosCoords | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    const coords = await Promise.race([
      getCurrentCoords({
        requirePermission: false,
        // Leave headroom inside the budget for the permission + last-known reads.
        timeoutMs: Math.max(500, budgetMs - 500),
      }).catch(() => null),
      timeout,
    ]);
    if (!coords || !isLatLng(coords.lat, coords.lng)) return null;
    const accuracy =
      typeof coords.accuracy === 'number' && Number.isFinite(coords.accuracy) && coords.accuracy >= 0
        ? Math.round(coords.accuracy)
        : null;
    return { lat: coords.lat, lng: coords.lng, accuracy };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Shape a persisted value back into coordinates (null when unusable). */
export function readSosCoords(value: unknown): SosCoords | null {
  const v = value as Partial<SosCoords> | null | undefined;
  if (!v || !isLatLng(v.lat, v.lng)) return null;
  return {
    lat: v.lat as number,
    lng: v.lng as number,
    accuracy: typeof v.accuracy === 'number' && Number.isFinite(v.accuracy) ? v.accuracy : null,
  };
}

/** Request body for the SOS trigger endpoints — omitted entirely without a fix. */
export function sosBody(
  coords: SosCoords | null | undefined,
): { lat: number; lng: number; accuracy?: number } | undefined {
  if (!coords) return undefined;
  return coords.accuracy != null
    ? { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy }
    : { lat: coords.lat, lng: coords.lng };
}
