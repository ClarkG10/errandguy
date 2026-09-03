/**
 * The customer's fare breakdown, in ONE place.
 *
 * Three screens show the same four-row table plus an optional promo row —
 * Review (pre-book, from an estimate), the tracking/detail sheet and the
 * rate screen (post-book, from the booking). Each built its own array with
 * its own label strings, so the fare the customer approved at checkout could
 * be re-labelled by the time they read the receipt, and a fifth surface
 * would have invented a fifth vocabulary.
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
 * Display only — every amount is a value the server already decided, and a
 * promo arrives as a positive discount that is rendered negative.
 */

export interface FareLine {
  label: string;
  amount: number;
}

/** The fare component fields, as they appear on both a booking and an estimate. */
export interface FareComponents {
  base_fee?: number | null;
  distance_fee?: number | null;
  service_fee?: number | null;
  surcharge?: number | null;
}

const num = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/**
 * Build the customer's fare rows.
 *
 * All four base rows are always present (a ₱0 surcharge is meaningful to a
 * customer checking why a fare moved), matching what the three screens
 * already rendered. The promo row appears only when a discount was applied.
 */
export function fareLines(
  fare: FareComponents | null | undefined,
  promoDiscount?: number | null,
): FareLine[] {
  if (!fare) return [];

  const lines: FareLine[] = [
    { label: 'Base Fee', amount: num(fare.base_fee) },
    { label: 'Distance Fee', amount: num(fare.distance_fee) },
    { label: 'Convenience Fee', amount: num(fare.service_fee) },
    { label: 'Surcharge', amount: num(fare.surcharge) },
  ];

  const promo = num(promoDiscount);
  if (promo > 0) {
    lines.push({ label: 'Promo Discount', amount: -promo });
  }

  return lines;
}
