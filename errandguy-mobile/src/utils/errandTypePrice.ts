import type { ErrandType } from '../types';

/**
 * The least a booking of this type can cost (₱), as the server prices it: the
 * cheapest vehicle it offers at 0 km, with the service fee and surcharge
 * included (`minimum_price` on /errand-types, ErrandType::minimumPrice).
 *
 * Null from a server that doesn't send it yet. The base fee is never shown in
 * its place: it leaves out the service fee, so "From ₱X" would quote a price
 * nobody can actually book at.
 */
export function errandTypeMinimumPrice(
  type: Pick<ErrandType, 'id'> & { minimum_price?: number | string | null },
): number | null {
  if (type.minimum_price == null) return null;
  const n = Number(type.minimum_price);
  return Number.isFinite(n) && n > 0 ? n : null;
}
