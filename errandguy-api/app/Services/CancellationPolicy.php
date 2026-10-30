<?php

namespace App\Services;

use App\Enums\BookingStatus;
use App\Models\Booking;

/**
 * CancellationPolicy
 *
 * Computes cancellation fees based on booking status at the time of
 * cancellation:
 *   - Before a runner has accepted (pending / matched): free cancel.
 *   - Accepted or heading to pickup: small flat fee ("convenience fee" —
 *     covers runner inconvenience).
 *   - Once the runner has arrived or started the errand: the customer can no
 *     longer cancel in the app (BookingPolicy::cancel) — support handles it.
 */
class CancellationPolicy
{
    /**
     * Flat fee (PHP) charged once a runner has accepted but not yet
     * started moving meaningfully toward pickup commitments.
     */
    public const ACCEPTED_FLAT_FEE = 20.00;

    /**
     * The statuses a customer can cancel from — the same window as
     * BookingPolicy::cancel and BookingResource::can_cancel.
     */
    private const CANCELLABLE_STATUSES = ['pending', 'matched', 'accepted', 'heading_to_pickup'];

    /**
     * Returns an array describing the fee that would be charged if the
     * booking were cancelled right now.
     *
     * Shape: [
     *   'fee'        => float,
     *   'tier'       => 'free' | 'flat',
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

        if (! in_array($status, self::CANCELLABLE_STATUSES, true)) {
            return [
                'fee' => 0.0,
                'tier' => 'free',
                'reason' => 'Your runner has already arrived or started the errand, so it can’t be cancelled in the app. Contact support if you need help.',
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

        // Accepted / heading to pickup: the flat fee, reduced to what
        // settlement can ACTUALLY keep, so the fee the customer is shown (and
        // agrees to) always matches BookingController::cancel's outcome
        // (PRICE-3 / PRICE-4):
        //   - a cash / unpaid booking collected nothing up front and there is no
        //     channel to charge a fee, so it is 0 (never a phantom fee); and
        //   - a flat fee can never exceed the fare (a ₱20 fee on a ₱15 errand is
        //     capped to ₱15), so a cheap errand can't be quoted more than its total.
        $total = (float) $booking->total_amount;
        $fee = $booking->payment_status === 'paid'
            ? round(min(self::ACCEPTED_FLAT_FEE, $total), 2)
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
            'tier' => 'flat',
            'reason' => 'A small ₱'.number_format($fee, 2).' fee applies — your runner is already on the way.',
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
