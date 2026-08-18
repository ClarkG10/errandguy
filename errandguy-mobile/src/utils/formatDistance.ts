/**
 * Format a trip distance in kilometres for display.
 *
 * The API sends `distance_km` as a Laravel decimal:2 value, i.e. a JSON STRING
 * like "14.60" (or "0.00" for an on-site errand). Rendering it verbatim showed
 * "14.60 km" on runner surfaces while the customer's booking review showed
 * "14.6 km" for the same trip, and a bare truthy gate treated the string "0.00"
 * as present ("0.00 km"). Coerce to a number and format to one decimal so every
 * surface agrees; return null for a zero/absent distance so callers can hide the
 * value or show their own fallback ("On-site" / "--").
 */
export function formatDistanceKm(
  value: number | string | null | undefined,
): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toFixed(1)} km`;
}
