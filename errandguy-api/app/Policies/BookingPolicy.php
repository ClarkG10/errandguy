<?php

namespace App\Policies;

use App\Models\Booking;
use App\Models\Review;
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
        // runner reviews the customer. We block reviews on bookings the
        // user wasn't part of, and we enforce one-review-per-reviewer.
        $isParticipant =
            $user->id === $booking->customer_id
            || ($booking->runner_id !== null && $user->id === $booking->runner_id);

        if (!$isParticipant) {
            return false;
        }

        if ($booking->status !== 'completed') {
            return false;
        }

        // Check no existing review from this reviewer for this booking
        return !Review::where('booking_id', $booking->id)
            ->where('reviewer_id', $user->id)
            ->exists();
    }

    public function track(User $user, Booking $booking): bool
    {
        return $user->id === $booking->customer_id
            || $user->id === $booking->runner_id;
    }

    /**
     * Re-attempt matching after a failed `no_runner` outcome. Only the
     * booking customer can retry, and only while the booking has not yet
     * been completed/cancelled or matched to someone else.
     */
    public function retryMatch(User $user, Booking $booking): bool
    {
        return $user->id === $booking->customer_id
            && in_array($booking->status, ['no_runner', 'pending'], true)
            && $booking->runner_id === null;
    }
}
