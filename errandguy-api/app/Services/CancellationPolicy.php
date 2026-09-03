<?php

namespace App\Services;

use App\Enums\BookingStatus;
use App\Models\Booking;

/**
 * CancellationPolicy
 *
 * Computes cancellation fees based on booking status at the time of
 * cancellation. The general principle:
 *   - Before a runner is matched (pending / matched): free cancel.
 *   - After a runner has accepted but not arrived: small flat fee
 *     ("convenience fee" — covers runner inconvenience).
 *   - After arrival / pickup: percentage of fare ("commitment fee").
 */
class CancellationPolicy
{
    /**
     * Flat fee (PHP) charged once a runner has accepted but not yet
     * started moving meaningfully toward pickup commitments.
     */
    public const ACCEPTED_FLAT_FEE = 20.00;

    /**
     * Percentage of total_amount charged once the runner is en route /
     * has arrived / is past the no-fault window.
     */
    public const ARRIVED_PERCENTAGE = 0.50; // 50%

    /**
     * Returns an array describing the fee that would be charged if the
     * booking were cancelled right now.
     *
     * Shape: [
     *   'fee'        => float,
     *   'tier'       => 'free' | 'flat' | 'percentage',
     *   'reason'     => string,
     *   'cancellable'=> bool,
     * ]
     */
    public static function preview(Booking $booking): array
    {
        $status = $booking->status;

        if (BookingStatus::isEnded($status)) {
            return [
                'fee' => 0.0,
                'tier' => 'free',
                'reason' => 'This booking can no longer be cancelled.',
                'cancellable' => false,
            ];
        }

        // Free: pre-match window.
        if (in_array($status, ['pending', 'matched'], true)) {
            return [
                'fee' => 0.0,
                'tier' => 'free',
                'reason' => 'No fee — runner has not accepted yet.',
                'cancellable' => true,
            ];
        }

        // Fee-charging tiers — compute the RAW policy fee for the status.
        if (in_array($status, ['accepted', 'heading_to_pickup'], true)) {
            $rawFee = self::ACCEPTED_FLAT_FEE;
            $tier = 'flat';
        } else {
            // Percentage: runner arrived / picked up / in-progress.
            $rawFee = round(((float) $booking->total_amount) * self::ARRIVED_PERCENTAGE, 2);
            $tier = 'percentage';
        }

        // Reduce the raw fee to what settlement can ACTUALLY keep, so the fee the
        // customer is shown (and agrees to) always matches BookingController::cancel's
        // outcome (PRICE-3 / PRICE-4):
        //   - a cash / unpaid booking collected nothing up front and there is no
        //     channel to charge a fee, so it is 0 (never a phantom fee); and
        //   - a flat fee can never exceed the fare (a ₱20 fee on a ₱15 errand is
        //     capped to ₱15), so a cheap errand can't be quoted more than its total.
        $total = (float) $booking->total_amount;
        $fee = $booking->payment_status === 'paid'
            ? round(min($rawFee, $total), 2)
            : 0.0;

        if ($fee <= 0.0) {
            return [
                'fee' => 0.0,
                'tier' => 'free',
                'reason' => $booking->payment_status === 'paid'
                    ? 'No fee — there is nothing left to charge on this errand.'
                    : 'No cancellation fee — this booking collected nothing up front.',
                'cancellable' => true,
            ];
        }

        return [
            'fee' => $fee,
            'tier' => $tier,
            'reason' => $tier === 'flat'
                ? 'A small ₱'.number_format($fee, 2).' fee applies — your runner is already on the way.'
                : 'A '.(int) (self::ARRIVED_PERCENTAGE * 100).'% fee (₱'.number_format($fee, 2).') applies — your runner has already arrived or started the errand.',
            'cancellable' => true,
        ];
    }

    /**
     * What COMES BACK if the booking were cancelled right now, and where it
     * lands — the half of the story preview() never told.
     *
     * A prepaid customer reads "a ₱20 fee applies" as a NEW charge on money
     * they have already handed over, and the one number they actually care
     * about (the ₱480 that returns, to the WALLET rather than back to GCash)
     * was computed nowhere. This mirrors BookingController::cancel exactly:
     *   - money only comes back when the booking actually collected some
     *     ('paid'); cash / unpaid errands return nothing because they took
     *     nothing (PRICE-3), and
     *   - the amount is total − the fee we can really keep, credited to the
     *     ErrandGuy wallet — never reversed to the source instrument.
     *
     * Advisory, exactly like the fee it accompanies: cancel() re-evaluates
     * under a row lock and its response carries the authoritative figures.
     *
     * Deliberately NOT folded into preview(): cancel() merges the pre-lock
     * preview into its `cancellation` payload alongside the settled
     * `refunded`, and two near-identical keys that can disagree is the sort
     * of money ambiguity this whole surface exists to remove.
     *
     * Shape: ['refund_amount' => float, 'refund_destination' => 'wallet'|null]
     *
     * @param  float|null  $fee  The already-computed preview fee, when the
     *                           caller has one (saves recomputing it).
     * @return array{refund_amount: float, refund_destination: ?string}
     */
    public static function refundPreview(Booking $booking, ?float $fee = null): array
    {
        // preview() is pure arithmetic over the booking's own attributes (no
        // queries), so recomputing it here to read `cancellable` is free.
        $policy = self::preview($booking);
        $effectiveFee = $fee ?? (float) $policy['fee'];

        // A booking that can no longer be cancelled has no refund to quote —
        // a completed errand is still 'paid' and must never be shown a
        // "you'd get ₱480 back" figure. Same for a booking that collected
        // nothing up front (cash / unpaid): there is nothing to give back.
        if (! $policy['cancellable'] || $booking->payment_status !== 'paid') {
            return ['refund_amount' => 0.0, 'refund_destination' => null];
        }

        $refund = round(max(0, (float) $booking->total_amount - $effectiveFee), 2);

        return [
            'refund_amount' => $refund,
            'refund_destination' => $refund > 0 ? 'wallet' : null,
        ];
    }
}
