import { Prisma } from '@prisma/client';

/**
 * Helpers that reproduce Laravel's JSON serialization conventions so the mobile
 * client sees byte-compatible payloads.
 *
 *  - `decimal:N` casts serialize as STRINGS ("0.00"), never numbers.
 *  - Carbon datetimes serialize as ISO-8601 UTC strings.
 */

export type DecimalInput = Prisma.Decimal | number | string | null | undefined;

/** Format a decimal-cast value as a fixed-precision STRING (Laravel `decimal:N`). */
export function dec(value: DecimalInput, places = 2): string | null {
  if (value === null || value === undefined) return null;
  try {
    return new Prisma.Decimal(value as Prisma.Decimal.Value).toFixed(places);
  } catch {
    return null;
  }
}

/** A decimal that must always be a string (non-nullable columns with defaults). */
export function decReq(value: DecimalInput, places = 2): string {
  return dec(value, places) ?? new Prisma.Decimal(0).toFixed(places);
}

/** Plain float (used where the Laravel resource casts to (float)). */
export function toFloat(value: DecimalInput): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ISO-8601 UTC string (Laravel Carbon JSON serialization). */
export function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Coerce a Prisma JsonValue that may hold an array; default to []. */
export function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
