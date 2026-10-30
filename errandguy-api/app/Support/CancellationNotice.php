<?php

namespace App\Support;

use App\Models\Booking;

/**
 * What the customer is told when their errand is cancelled: why, and what
 * happened to their money — "Your errand #EG-… was cancelled: no runner was
 * available. ₱150.00 was returned to your ErrandGuy wallet."
 *
 * The money sentence is read from the booking as it stands AFTER the refund
 * ran, so it only ever claims what happened: refunds go to the ErrandGuy
 * wallet, a cash or unpaid errand collected nothing, and a recorded
 * cancellation fee is named.
 */
final class CancellationNotice
{
    public const BY_CUSTOMER = 'customer';

    public const BY_STAFF = 'staff';

    public const NO_RUNNER = 'no_runner';

    public const PAYMENT_NOT_COMPLETED = 'payment_not_completed';

    /** Longest staff reason quoted in a push; the full text is on the errand. */
    private const REASON_LIMIT = 140;

    public static function forCustomer(
        Booking $booking,
        string $cause,
        ?string $staffReason = null,
        bool $feeWentToRunner = false,
    ): string {
        $number = $booking->booking_number ?? $booking->id;

        $why = match ($cause) {
            self::BY_CUSTOMER => "You cancelled errand #{$number}.",
            self::BY_STAFF => "Your errand #{$number} was cancelled by ErrandGuy support"
                .(filled($staffReason) ? ': '.rtrim(mb_strimwidth(trim((string) $staffReason), 0, self::REASON_LIMIT, '…'), '.') : '')
                .'.',
            self::NO_RUNNER => "Your errand #{$number} was cancelled: no runner was available.",
            self::PAYMENT_NOT_COMPLETED => "Your errand #{$number} was cancelled: the payment wasn't completed.",
            default => "Your errand #{$number} was cancelled.",
        };

        return $why.' '.self::money($booking, $feeWentToRunner);
    }

    /** The money sentence on its own, e.g. for an unmatched errand's notice. */
    public static function money(Booking $booking, bool $feeWentToRunner = false): string
    {
        $current = Booking::query()->whereKey($booking->id)
            ->first(['id', 'payment_status', 'total_amount', 'cancellation_fee']) ?? $booking;

        $total = round((float) $current->total_amount, 2);
        $fee = round((float) $current->cancellation_fee, 2);

        return match ($current->payment_status) {
            'refunded' => self::refundedSentence(max(0, round($total - $fee, 2)), $fee, $feeWentToRunner),
            'paid' => 'Your '.self::peso($total).' payment is being returned to your ErrandGuy wallet.',
            default => 'You weren’t charged.',
        };
    }

    private static function refundedSentence(float $refunded, float $fee, bool $feeWentToRunner): string
    {
        if ($fee <= 0) {
            return self::peso($refunded).' was returned to your ErrandGuy wallet.';
        }

        $feeLine = 'A '.self::peso($fee).' cancellation fee '.($feeWentToRunner ? 'went to your runner' : 'was charged');

        return $refunded > 0
            ? $feeLine.' and '.self::peso($refunded).' was returned to your ErrandGuy wallet.'
            : $feeLine.', so nothing was refunded.';
    }

    private static function peso(float $amount): string
    {
        return '₱'.number_format($amount, 2);
    }
}
