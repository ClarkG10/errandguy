<?php

namespace App\Filament\Support;

/**
 * Plain-language names for the codes stored on errands and payments, so staff
 * read "Heading to pickup" and "GCash" instead of `heading_to_pickup` and
 * `gcash`. One list for every column, entry and filter in the panel.
 */
class StatusLabels
{
    public const BOOKING = [
        'pending' => 'Pending',
        'matched' => 'Matched',
        'accepted' => 'Accepted',
        'heading_to_pickup' => 'Heading to pickup',
        'arrived_at_pickup' => 'Arrived at pickup',
        'picked_up' => 'Picked up',
        'in_transit' => 'In transit',
        'arrived_at_dropoff' => 'Arrived at dropoff',
        'delivered' => 'Delivered',
        'completed' => 'Completed',
        'cancelled' => 'Cancelled',
        'no_runner' => 'No runner',
    ];

    public const PAYMENT = [
        'unpaid' => 'Unpaid',
        'pending' => 'Pending',
        'paid' => 'Paid',
        'refunded' => 'Refunded',
        'failed' => 'Failed',
        'expired' => 'Expired',
    ];

    public const METHOD = [
        'wallet' => 'Wallet',
        'gcash' => 'GCash',
        'maya' => 'Maya',
        'cash' => 'Cash',
        // Retired; older errands keep it.
        'card' => 'Card (legacy)',
        'grabpay' => 'GrabPay (legacy)',
    ];

    public static function booking(?string $status): string
    {
        return self::label(self::BOOKING, $status);
    }

    public static function payment(?string $status): string
    {
        return self::label(self::PAYMENT, $status);
    }

    public static function method(?string $method): string
    {
        return self::label(self::METHOD, $method);
    }

    /** A code with no entry still reads as words ("some_new_state" → "Some new state"). */
    private static function label(array $labels, ?string $code): string
    {
        if ($code === null || $code === '') {
            return '—';
        }

        return $labels[$code] ?? ucfirst(str_replace('_', ' ', $code));
    }
}
