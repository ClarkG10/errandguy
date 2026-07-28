<?php

namespace App\Jobs;

use App\Events\BookingStatusChanged;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\SystemConfig;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Re-matches fixed-price bookings whose matched runner never accepted in time.
 *
 * MatchRunnerJob assigns the nearest runner and sets status='matched'. If that
 * runner ignores the offer, nothing previously recovered the booking (only an
 * explicit decline did), so it stranded on "Runner Found" forever while the
 * customer's money sat locked (SYSTEM_AUDIT H12). This sweep resets such
 * bookings to 'pending' and re-dispatches matching, excluding the unresponsive
 * runner so a different one is tried. The created_at-based AutoCancelBookingJob
 * still bounds the total wait, so this cannot loop forever.
 *
 * Runs on a schedule (routes/console.php) rather than as a per-booking delayed
 * job so a dropped/never-run delayed job can't silently strand a booking.
 */
class ExpireStaleMatchesJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public function handle(): void
    {
        $timeoutSeconds = (int) SystemConfig::getValue('matched_acceptance_timeout_seconds', '90');
        $cutoff = now()->subSeconds($timeoutSeconds);

        $stale = Booking::where('status', 'matched')
            ->where('pricing_mode', 'fixed')
            ->whereNotNull('matched_at')
            ->where('matched_at', '<', $cutoff)
            ->limit(100)
            ->get();

        foreach ($stale as $staleBooking) {
            $didReset = false;
            $previousRunnerId = null;

            DB::transaction(function () use ($staleBooking, &$didReset, &$previousRunnerId) {
                // Re-read under a lock: the runner may have accepted (or the
                // booking been cancelled) between the query and now.
                $booking = Booking::whereKey($staleBooking->id)->lockForUpdate()->first();
                if (! $booking || $booking->status !== 'matched') {
                    return;
                }

                $previousRunnerId = $booking->runner_id;

                $booking->update([
                    'status' => 'pending',
                    'runner_id' => null,
                    'matched_at' => null,
                ]);

                BookingStatusLog::create([
                    'booking_id' => $booking->id,
                    'status' => 'pending',
                    'changed_by' => null,
                    'note' => 'Matched runner did not accept in time; re-matching.',
                ]);

                $didReset = true;
            });

            // Re-dispatch matching outside the lock, skipping the runner who
            // just let the offer lapse so a different one is tried.
            if ($didReset) {
                Log::info("ExpireStaleMatchesJob: re-matching booking {$staleBooking->id} (skipping ".($previousRunnerId ?? 'none').')');

                // Broadcast matched -> pending so the customer's "Runner Found"
                // screen drops the phantom (now-unassigned) runner live, exactly
                // like the manual decline path. `pending` has no push template,
                // so this is broadcast-only — no spurious notification.
                event(new BookingStatusChanged(Booking::find($staleBooking->id), 'matched', 'pending'));

                MatchRunnerJob::dispatch($staleBooking->id, null, $previousRunnerId);
            }
        }
    }
}
