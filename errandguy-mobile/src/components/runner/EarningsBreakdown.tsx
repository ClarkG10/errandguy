import React from 'react';
import { View, Text } from 'react-native';
import { formatCurrency } from '../../utils/formatCurrency';
import { LightColors } from '../../constants/colors';
import type { Booking } from '../../types';

/**
 * Per-errand fee breakdown for the runner.
 *
 * Why the maths is written this way — the server stores base_fee,
 * distance_fee, service_fee and surcharge but NOT the per-vehicle base
 * premium that PricingService folds into the price, and `total_amount` has
 * the customer's promo discount already subtracted while `runner_payout`
 * does not. So the stored columns do NOT sum to total_amount, and printing
 * them as if they did would be a lie on a money screen.
 *
 * What IS exact, by construction in PricingService::calculate:
 *
 *   runner_payout = base_fee + vehicle_premium + distance_fee + surcharge
 *
 * so the runner's OWN take-home decomposes perfectly once the unstored
 * vehicle premium is recovered as the residual. That is what we render —
 * a breakdown of the payout, not a reconstruction of the customer's bill.
 * If the residual ever comes out negative (a hand-edited or legacy row) we
 * fall back to a single honest line instead of showing numbers that don't
 * add up.
 *
 * The same rule governs the customer-side footer: a promo is a
 * PLATFORM-funded subsidy (BookingController::store stores total_amount
 * minus the discount and leaves runner_payout untouched), so service_fee
 * overstates what the platform actually took by exactly the discount. The
 * fee we print is therefore total_amount − runner_payout, the identical
 * figure settlement moves (RunnerErrandController::settleEarnings:
 * commission = total_amount − runner_payout) — which keeps
 * customer paid − platform fee === payout in every mode.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const EPS = 0.005;

const num = (v: unknown): number => {
  // Laravel decimal casts arrive as JSON strings ("14.60").
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface BreakdownLine {
  label: string;
  amount: number;
}

export interface EarningsBreakdownResult {
  /** False when the payload can't be decomposed honestly — render the
   *  payout alone. */
  itemized: boolean;
  mode: 'fixed' | 'negotiate';
  lines: BreakdownLine[];
  /** The runner's take-home. Null when the server hasn't computed it. */
  payout: number | null;
  /** The platform's cut on this errand, net of any promo it funded — always
   *  customerPaid − payout. Null when unknown. */
  platformFee: number | null;
  /** What the customer was charged, promo already off. Null when unknown. */
  customerPaid: number | null;
  /** Cash errands only: peso figure settled against the runner's wallet.
   *  Positive = debited (the platform's fee), negative = credited back. */
  cashSettlement: number | null;
  /** Footer sentence reconciling the customer's bill with the payout. */
  feeNote: string | null;
  /** One-line honest statement of where the money went. */
  settlementNote: string | null;
}

/**
 * Booking fields BookingResource sends to RUNNER viewers that the shared
 * `Booking` type may not declare yet. Read structurally so this never
 * collides with another agent widening the shared type.
 */
const paymentMethodTypeOf = (booking: Booking): string | null => {
  const raw = (booking as { payment_method_type?: unknown }).payment_method_type;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

export function computeEarningsBreakdown(booking: Booking): EarningsBreakdownResult {
  const payout = booking.runner_payout != null ? num(booking.runner_payout) : null;
  const serviceFee = booking.service_fee != null ? num(booking.service_fee) : null;
  const totalAmount = booking.total_amount != null ? num(booking.total_amount) : null;
  const promoDiscount = booking.promo_discount != null ? num(booking.promo_discount) : 0;
  const method = paymentMethodTypeOf(booking);
  const isNegotiate = booking.pricing_mode === 'negotiate';

  // NOT service_fee: on a promo booking the discount is funded out of the
  // platform's cut, so service_fee is the gross fee and this is what the
  // platform actually keeps.
  const platformFee = payout != null && totalAmount != null ? round2(totalAmount - payout) : null;

  // Cash errands settle the other way round: the runner already holds the
  // fare, so the platform debits that same cut from their wallet
  // (RunnerErrandController::settleEarnings).
  const cashSettlement = method === 'cash' ? platformFee : null;

  // Naming the gross fee alongside the promo keeps every figure on the panel
  // reconcilable (fee − promo = kept), including the "Platform fee" line a
  // negotiate breakdown prints. If the two can't be reconciled — a legacy or
  // hand-edited row — say nothing about the promo rather than print a
  // subtraction that doesn't hold.
  let feeNote: string | null = null;
  if (platformFee != null && totalAmount != null) {
    feeNote =
      promoDiscount > EPS &&
      serviceFee != null &&
      Math.abs(round2(serviceFee - promoDiscount) - platformFee) <= 0.02
        ? `Customer paid ${formatCurrency(totalAmount)} after a ${formatCurrency(
            promoDiscount,
          )} promo — the platform funded that from its ${formatCurrency(
            serviceFee,
          )} fee and kept ${formatCurrency(platformFee)}.`
        : `Customer paid ${formatCurrency(totalAmount)} · platform fee ${formatCurrency(
            platformFee,
          )}`;
  }

  let settlementNote: string | null = null;
  if (method === 'cash') {
    settlementNote =
      cashSettlement != null && cashSettlement > EPS
        ? `Cash errand — you collected the fare in person, and the ${formatCurrency(
            cashSettlement,
          )} platform fee was settled from your ErrandGuy wallet.`
        : 'Cash errand — you collected the fare in person.';
  } else if (method) {
    settlementNote = 'Paid online — this payout goes to your ErrandGuy wallet.';
  }

  const base = {
    payout,
    platformFee,
    customerPaid: totalAmount,
    cashSettlement,
    feeNote,
    settlementNote,
  };

  if (payout == null) {
    return { ...base, itemized: false, mode: isNegotiate ? 'negotiate' : 'fixed', lines: [] };
  }

  if (isNegotiate) {
    // Negotiate: the customer's offer IS the total, and the platform still
    // takes its computed service fee (PricingService::applyNegotiateOffer).
    const offer = booking.customer_offer != null ? num(booking.customer_offer) : totalAmount;
    if (offer == null || serviceFee == null || Math.abs(offer - serviceFee - payout) > 0.02) {
      return { ...base, itemized: false, mode: 'negotiate', lines: [] };
    }
    return {
      ...base,
      itemized: true,
      mode: 'negotiate',
      lines: [
        { label: 'Agreed offer', amount: offer },
        { label: 'Platform fee', amount: -serviceFee },
      ],
    };
  }

  const baseFee = num(booking.base_fee);
  const distanceFee = num(booking.distance_fee);
  const surcharge = num(booking.surcharge);
  const residual = round2(payout - baseFee - distanceFee - surcharge);

  // Components already exceed the payout → the row can't be decomposed
  // truthfully. Show the payout alone rather than an invented negative line.
  if (residual < -EPS) {
    return { ...base, itemized: false, mode: 'fixed', lines: [] };
  }

  const km = booking.distance_km != null ? num(booking.distance_km) : null;
  const lines: BreakdownLine[] = [{ label: 'Base fare', amount: baseFee }];
  if (distanceFee > EPS || km) {
    lines.push({
      label: km ? `Distance · ${km.toFixed(1)} km` : 'Distance',
      amount: distanceFee,
    });
  }
  if (residual > EPS) lines.push({ label: 'Vehicle & handling', amount: residual });
  if (surcharge > EPS) lines.push({ label: 'Surcharge & extras', amount: surcharge });

  return { ...base, itemized: true, mode: 'fixed', lines };
}

interface EarningsBreakdownProps {
  booking: Booking;
}

/**
 * Inline "where did this ₱X come from?" panel, expanded from a per-errand
 * earnings row. Display only — it computes nothing the server didn't already
 * decide.
 */
export function EarningsBreakdown({ booking }: EarningsBreakdownProps) {
  const b = computeEarningsBreakdown(booking);

  return (
    <View
      className="rounded-xl px-3 py-3 mb-3"
      style={{ backgroundColor: LightColors.surfaceMuted }}
      accessible={false}
    >
      {b.itemized ? (
        b.lines.map((line) => (
          <View key={line.label} className="flex-row items-baseline justify-between py-1">
            <Text
              className="text-[12px] font-montserrat text-textSecondary flex-1 pr-3"
              numberOfLines={1}
            >
              {line.label}
            </Text>
            <Text className="text-[12px] font-inter tabular-nums text-textPrimary">
              {line.amount < 0 ? '−' : ''}
              {formatCurrency(Math.abs(line.amount))}
            </Text>
          </View>
        ))
      ) : (
        <Text className="text-[12px] font-montserrat text-textSecondary py-1">
          {b.payout == null
            ? "This errand's payout hasn't been computed yet."
            : 'A full fee breakdown isn’t available for this errand.'}
        </Text>
      )}

      {b.payout != null && (
        <View
          className="flex-row items-baseline justify-between pt-2 mt-1"
          style={{ borderTopWidth: 1, borderTopColor: LightColors.divider }}
        >
          <Text className="text-[12px] font-montserrat-bold text-textPrimary">Your payout</Text>
          <Text className="text-[14px] font-inter-semi tabular-nums text-textPrimary">
            {formatCurrency(b.payout)}
          </Text>
        </View>
      )}

      {b.feeNote && (
        <Text className="text-[11px] font-montserrat text-textTertiary mt-2">{b.feeNote}</Text>
      )}

      {b.settlementNote && (
        <Text className="text-[11px] font-montserrat text-textTertiary mt-1">
          {b.settlementNote}
        </Text>
      )}
    </View>
  );
}
