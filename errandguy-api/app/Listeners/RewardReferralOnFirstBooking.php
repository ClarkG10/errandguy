<?php

namespace App\Listeners;

use App\Events\BookingStatusChanged;
use App\Models\Booking;
use App\Models\Referral;
use App\Services\ReferralService;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Credits the referral bonus to both parties when a referred customer
 * (the referee) completes their FIRST errand. The referee is the
 * booking's customer. Fully idempotent — ReferralService::reward locks
 * the referral row and no-ops if it was already rewarded.
 */
class RewardReferralOnFirstBooking implements ShouldQueue
{
    public function __construct(
        private ReferralService $referralService,
    ) {}

    public function handle(BookingStatusChanged $event): void
    {
        if ($event->newStatus !== 'completed') {
            return;
        }

        $refereeId = $event->booking->customer_id;
        if (!$refereeId) {
            return;
        }

        // Only act if this customer was actually referred and the reward
        // is still outstanding — cheap short-circuit before the count query.
        $hasPendingReferral = Referral::where('referee_id', $refereeId)
            ->where('status', '!=', 'rewarded')
            ->exists();
        if (!$hasPendingReferral) {
            return;
        }

        // Reward once the referee has AT LEAST ONE completed booking. We do
        // NOT gate on exactly 1: this listener is queued (ShouldQueue), so if
        // the referee completes a second booking before the first's job is
        // processed, a strict `!== 1` check would see count=2 for BOTH jobs
        // and silently drop the reward forever. reward() is idempotent
        // (locks the referral row, no-ops if already rewarded), so triggering
        // on every completion is safe and closes that lost-reward window.
        $completedCount = Booking::where('customer_id', $refereeId)
            ->where('status', 'completed')
            ->count();
        if ($completedCount < 1) {
            return;
        }

        $this->referralService->reward($refereeId);
    }
}
