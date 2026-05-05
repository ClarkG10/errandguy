<?php

namespace App\Policies;

use App\Models\Booking;
use App\Models\User;

class BookingPolicy
{
    public function view(User $user, Booking $booking): bool
    {
        return $user->id === $booking->customer_id
            || $user->id === $booking->runner_id;
    }

    public function cancel(User $user, Booking $booking): bool
    {
        return $user->id === $booking->customer_id
            && in_array($booking->status, ['pending', 'matched', 'accepted']);
    }

    public function review(User $user, Booking $booking): bool
    {
        // Either party of a completed booking may leave one review. The
        // reviewee is implicit — customer reviews the assigned runner,
        // runner reviews the customer.
        //
        // We deliberately keep this check narrow (participant + completed
        // only). Duplicate-submission and other lifecycle errors are
        // surfaced by the controller as 422 with a descriptive message;
        // collapsing them into 403 here loses that granularity and the
        // mobile client was logging spurious "unauthorized" errors when
        // a runner re-entered a completed errand and the rate sheet
        // auto-submitted a duplicate review.
        $isParticipant =
            $user->id === $booking->customer_id
            || ($booking->runner_id !== null && $user->id === $booking->runner_id);

        if (!$isParticipant) {
            return false;
        }

        return $booking->status === 'completed';
    }

    public function track(User $user, Booking $booking): bool
    {
        return $user->id === $booking->customer_id
            || $user->id === $booking->runner_id;
    }

    /**
     * Re-attempt matching after a failed `no_runner` outcome. Only the
     * booking customer can retry, and only while the booking has not
     * yet been matched/accepted by a runner. We also accept `cancelled`
     * rows whose cancellation was the auto-cancel safety net firing
     * — the customer is allowed to revive their own auto-killed
     * search, but cannot un-cancel a booking they (or a runner)
     * cancelled deliberately.
     */
    public function retryMatch(User $user, Booking $booking): bool
    {
        if ($user->id !== $booking->customer_id || $booking->runner_id !== null) {
            return false;
        }

        if (in_array($booking->status, ['no_runner', 'pending'], true)) {
            return true;
        }

        if ($booking->status === 'cancelled'
            && is_string($booking->cancellation_reason)
            && str_starts_with($booking->cancellation_reason, 'Auto-cancelled')
        ) {
            return true;
        }

        return false;
    }
}
