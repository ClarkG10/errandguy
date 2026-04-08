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
        if ($user->id !== $booking->customer_id) {
            return false;
        }

        if ($booking->status !== 'completed') {
            return false;
        }

        // Check no existing review
        return !Review::where('booking_id', $booking->id)
            ->where('reviewer_id', $user->id)
            ->exists();
    }

    public function track(User $user, Booking $booking): bool
    {
        return $user->id === $booking->customer_id
            || $user->id === $booking->runner_id;
    }
}
