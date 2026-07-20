<?php

namespace App\Enums;

/**
 * Settlement state of a Booking as shown to the customer/runner. Distinct from
 * {@see PaymentStatus} (which tracks an individual gateway charge): a booking
 * summarises where its money stands overall.
 *
 * Not guarded by a transition table this phase — used for type-safety and as
 * the documented vocabulary the mobile status endpoint reports.
 */
enum BookingPaymentStatus: string
{
    case Unpaid = 'unpaid';       // nothing collected (cash, collected on completion)
    case Pending = 'pending';     // payment handed off to gateway, awaiting confirmation
    case Paid = 'paid';           // fully settled
    case Refunded = 'refunded';   // settled then refunded (e.g. after cancellation)
    case Failed = 'failed';       // payment attempt failed
    case Expired = 'expired';     // checkout expired before payment
}
