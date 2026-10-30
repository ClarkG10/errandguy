/**
 * The customer's fare breakdown, in ONE place.
 *
 * Three screens show the same four-row table — Review (pre-book, from an
 * estimate), the tracking/detail sheet and the rate screen (post-book, from
 * the booking). Each built its own array with its own label strings, so the
 * fare the customer approved at checkout could be re-labelled by the time they
 * read the receipt, and a fifth surface would have invented a fifth vocabulary.
 *
 * LABELS (settled): `service_fee` is shown as **Convenience Fee** — never
 * "Service fee", which is what the runner's side calls the platform's cut
 * (see `components/runner/EarningsBreakdown.tsx`). The two tables describe
 * different money and are deliberately NOT unified: this one is what the
 * customer pays, that one is how the runner's payout decomposes.
 *
 * Title Case is the table-row convention here and stays as-is; the
 * sentence-case rule in `constants/copy.ts` governs prose and status labels.
 *
 * Display only — every amount is a value the server already decided.
 *
 * The optional discount row is history. Promo codes are retired, so a new
 * booking always carries `promo_discount` 0 and Review never passes one. Only a
 * booking made while promo codes existed can still have a saving, and its
 * receipt keeps showing it (a positive discount, rendered negative) so the rows
 * still add up to what that customer was actually charged.
 */

export interface FareLine {
  label: string;
  amount: number;
}

/** The fare component fields, as they appear on both a booking and an estimate. */
export interface FareComponents {
  base_fee?: number | string | null;
  distance_fee?: number | string | null;
  service_fee?: number | string | null;
  surcharge?: number | string | null;
}

/**
 * A booking's money arrives as Laravel `decimal:2` JSON STRINGS ("50.00"),
 * while an estimate sends plain numbers. Accept both: treating the strings as
 * 0 printed every receipt row as ₱0.00 and hid an older booking's discount.
 */
const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Build the customer's fare rows.
 *
 * All four base rows are always present (a ₱0 surcharge is meaningful to a
 * customer checking why a fare moved), matching what the three screens
 * already rendered. The discount row appears only when the booking actually
 * carries one (`promo_discount` > 0, i.e. an older promo-code booking).
 */
export function fareLines(
  fare: FareComponents | null | undefined,
  promoDiscount?: number | string | null,
): FareLine[] {
  if (!fare) return [];

  const lines: FareLine[] = [
    { label: 'Base Fee', amount: num(fare.base_fee) },
    { label: 'Distance Fee', amount: num(fare.distance_fee) },
    { label: 'Convenience Fee', amount: num(fare.service_fee) },
    { label: 'Surcharge', amount: num(fare.surcharge) },
  ];

  const discount = num(promoDiscount);
  if (discount > 0) {
    lines.push({ label: 'Promo Discount', amount: -discount });
  }

  return lines;
}
