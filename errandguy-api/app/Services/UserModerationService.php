<?php

namespace App\Services;

use App\Enums\BookingStatus;
use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\RunnerProfile;
use App\Models\User;

/**
 * Account suspension, shared by the Filament single and bulk "Suspend"
 * actions so the two can never drift.
 */
class UserModerationService
{
    /**
     * Suspend a user: lock them out, end their sessions, and — when they are a
     * runner — take them offline at once so matching stops offering them work
     * (MatchingService also refuses any account that isn't active, so even a
     * stale online flag can't get them an offer).
     *
     * A runner suspended mid-errand still has a customer waiting on them, so
     * staff get a live alert for each errand they were holding to reassign
     * (Bookings → Return to matching) or cancel it. An offer they had not
     * accepted yet simply lapses: they can no longer sign in to accept it.
     *
     * Returns false when the user was already suspended (nothing changed).
     */
    public function suspend(User $user, string $reason): bool
    {
        if ($user->status === 'suspended') {
            return false;
        }

        $user->update([
            'status' => 'suspended',
            'suspended_reason' => $reason,
            'suspended_at' => now(),
        ]);
        $user->tokens()->delete();

        RunnerProfile::switchOffline($user->id);

        Booking::where('runner_id', $user->id)
            ->whereIn('status', BookingStatus::IN_PROGRESS)
            ->get(['id', 'booking_number'])
            ->each(fn (Booking $booking) => AdminAlert::raise(
                'runner_suspended_mid_errand',
                'critical',
                'Suspended runner was mid-errand',
                ($user->full_name ?? 'A runner').' was suspended while working errand '
                    .($booking->booking_number ?? $booking->id)
                    .'. Return it to matching or cancel it — the customer is still waiting.',
                $booking->id,
            ));

        return true;
    }
}
