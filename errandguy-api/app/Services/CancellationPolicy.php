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

        // Flat fee: runner accepted but hasn't arrived at pickup.
        if (in_array($status, ['accepted', 'heading_to_pickup'], true)) {
            return [
                'fee' => self::ACCEPTED_FLAT_FEE,
                'tier' => 'flat',
                'reason' => 'A small ₱'.number_format(self::ACCEPTED_FLAT_FEE, 0).' fee applies — your runner is already on the way.',
                'cancellable' => true,
            ];
        }

        // Percentage: runner arrived / picked up / in-progress.
        $fee = round(((float) $booking->total_amount) * self::ARRIVED_PERCENTAGE, 2);

        return [
            'fee' => $fee,
            'tier' => 'percentage',
            'reason' => 'A '.(int) (self::ARRIVED_PERCENTAGE * 100).'% fee applies — your runner has already arrived or started the errand.',
            'cancellable' => true,
        ];
    }
}
