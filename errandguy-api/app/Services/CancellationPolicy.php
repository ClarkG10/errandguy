<?php

namespace App\Services;

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

        if (in_array($status, ['completed', 'cancelled', 'no_runner'], true)) {
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
}
