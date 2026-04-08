<?php

namespace App\Policies;

use App\Models\Booking;
use App\Models\User;

class RunnerErrandPolicy
{
    public function accept(User $user, Booking $booking): bool
    {
        $profile = $user->runnerProfile;

        if (!$profile) {
            return false;
        }

        // Runner must be online and approved
        if (!$profile->is_online || $profile->verification_status !== 'approved') {
            return false;
        }

        // Booking must be in an assignable state
        return in_array($booking->status, ['pending', 'matched']);
    }

    public function updateStatus(User $user, Booking $booking): bool
    {
        return $user->id === $booking->runner_id;
    }

    public function verifyPin(User $user, Booking $booking): bool
    {
        return $user->id === $booking->runner_id
            && $booking->is_transportation;
    }
}
