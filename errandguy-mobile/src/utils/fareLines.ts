/**
 * The customer's fare breakdown, in ONE place.
 *
 * Three screens show the same fare table — Review (pre-book, from an
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
  /** The vehicle's flat premium (walk 0, bicycle 10, motorcycle 25, car 60).
   *  An estimate sends it; a booking never stored it (see vehicleFee()). */
  vehicle_premium?: number | string | null;
  distance_fee?: number | string | null;
  service_fee?: number | string | null;
  surcharge?: number | string | null;
  total_amount?: number | string | null;
  /** Legacy: an old 'negotiate' booking's total is the customer's own price,
   *  not base + vehicle + distance + fees. */
  pricing_mode?: string | null;
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

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The vehicle premium, or null when it can't be told.
 *
 * PricingService adds a flat premium for the vehicle on top of the base fee,
 * and an estimate sends it as `vehicle_premium`. A booking stores base,
 * distance, convenience and surcharge but not the premium, so a motorcycle
 * receipt read Base ₱50 + Distance ₱6.45 + Convenience ₱12.22 = ₱68.67 under a
 * ₱93.67 total. On a booking it is recovered as what the total holds beyond the
 * stored rows (the same rule the runner's EarningsBreakdown uses). A negative
 * remainder (a hand-edited row) or an old 'negotiate' booking gets no row.
 */
function vehicleFee(fare: FareComponents, discount: number): number | null {
  if (fare.vehicle_premium != null) return num(fare.vehicle_premium);
  if (fare.total_amount == null || fare.pricing_mode === 'negotiate') return null;
  const rest = round2(
    num(fare.total_amount) + discount - num(fare.base_fee) - num(fare.distance_fee)
      - num(fare.service_fee) - num(fare.surcharge),
  );
  return rest >= 0 ? rest : null;
}

/**
 * Build the customer's fare rows.
 *
 * The four base rows are always present (a ₱0 surcharge is meaningful to a
 * customer checking why a fare moved); the vehicle row follows the base fee
 * whenever it can be told, so the rows add up to the total. The discount row
 * appears only when the booking actually carries one (`promo_discount` > 0,
 * i.e. an older promo-code booking).
 */
export function fareLines(
  fare: FareComponents | null | undefined,
  promoDiscount?: number | string | null,
): FareLine[] {
  if (!fare) return [];

  const discount = num(promoDiscount);
  const vehicle = vehicleFee(fare, discount);
  const lines: FareLine[] = [
    { label: 'Base Fee', amount: num(fare.base_fee) },
    ...(vehicle !== null ? [{ label: 'Vehicle Fee', amount: vehicle }] : []),
    { label: 'Distance Fee', amount: num(fare.distance_fee) },
    { label: 'Convenience Fee', amount: num(fare.service_fee) },
    { label: 'Surcharge', amount: num(fare.surcharge) },
  ];

  if (discount > 0) {
    lines.push({ label: 'Promo Discount', amount: -discount });
  }

  return lines;
}
