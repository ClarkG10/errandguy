<?php

namespace App\Console\Commands;

use App\Enums\BookingStatus;
use App\Jobs\SendPushJob;
use App\Models\RunnerProfile;
use Illuminate\Console\Command;

/**
 * Switches a waiting runner offline after a long silence.
 *
 * Matching still offers work to a runner whose last location is a few minutes
 * old (MatchingService::LOCATION_FRESHNESS_MINUTES) because a locked phone stops
 * reporting it and the offer push wakes it. But a runner who closed the app
 * and walked away stays "online" forever, inflating the online count staff and
 * the heatmap see. After STALE_AFTER_MINUTES with no location this switches
 * them offline and tells them by push, so they know why offers stopped.
 *
 * A runner holding an offer or an errand is never touched — live-errand
 * silence is DetectStalledErrandsCommand's job, and it raises a staff alert
 * instead of changing anything.
 */
class ExpireStaleRunnerPresenceCommand extends Command
{
    protected $signature = 'errandguy:expire-stale-runner-presence';

    protected $description = 'Switch waiting runners offline after 30 minutes without a location update.';

    public const STALE_AFTER_MINUTES = 30;

    private const MAX_PER_RUN = 500;

    public function handle(): int
    {
        $cutoff = now()->subMinutes(self::STALE_AFTER_MINUTES);

        $userIds = RunnerProfile::where('is_online', true)
            ->where(fn ($q) => $this->silentSince($q, $cutoff))
            ->whereDoesntHave('bookings', fn ($b) => $b->whereIn('status', BookingStatus::RUNNER_HELD))
            ->limit(self::MAX_PER_RUN)
            ->pluck('user_id');

        $switched = 0;
        foreach ($userIds as $userId) {
            // Re-check staleness in the write itself, so a location ping (or a
            // fresh "go online") that landed after the read above wins.
            $updated = RunnerProfile::where('user_id', $userId)
                ->where('is_online', true)
                ->where(fn ($q) => $this->silentSince($q, $cutoff))
                ->update(['is_online' => false, 'online_since' => null]);

            if ($updated !== 1) {
                continue;
            }

            $switched++;
            SendPushJob::dispatch(
                (string) $userId,
                'You’re offline now',
                'We haven’t had your location for '.self::STALE_AFTER_MINUTES.' minutes. '
                    .'You’re offline — open ErrandGuy and switch Online on again to get errands.',
                ['type' => 'system', 'reason' => 'stale_location'],
            );
        }

        $this->info("Switched {$switched} silent runner(s) offline.");

        return self::SUCCESS;
    }

    /**
     * No location since $cutoff. A legacy row with no location at all counts
     * from its last update (going online writes both).
     *
     * @param  \Illuminate\Database\Eloquent\Builder  $query
     */
    private function silentSince($query, \DateTimeInterface $cutoff)
    {
        return $query->where('last_location_at', '<', $cutoff)
            ->orWhere(fn ($legacy) => $legacy->whereNull('last_location_at')->where('updated_at', '<', $cutoff));
    }
}
