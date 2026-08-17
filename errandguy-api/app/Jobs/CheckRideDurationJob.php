<?php

namespace App\Jobs;

use App\Events\RideDurationAlert;
use App\Models\Booking;
use App\Models\SystemConfig;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class CheckRideDurationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public function handle(): void
    {
        $multiplier = (float) SystemConfig::getValue('ride_duration_alert_multiplier', '2.0');

        // Find active transportation bookings that are in transit. Iterate in
        // id-ordered chunks rather than ->get()-ing the whole set into memory:
        // the loop only reads each row and dispatches best-effort alerts (it does
        // not mutate the status/sos_triggered filter columns), so the result set
        // is stable across chunks and none is skipped.
        Booking::where('is_transportation', true)
            ->where('status', 'in_transit')
            ->whereNotNull('picked_up_at')
            ->where('sos_triggered', false)
            ->chunkById(200, function ($bookings) use ($multiplier): void {
                foreach ($bookings as $booking) {
                    $pickedUpAt = $booking->picked_up_at;
                    // Carbon 3 diffInMinutes is SIGNED: now()->diffInMinutes($past) is
                    // negative, so the threshold check below could never fire. Diff from
                    // the earlier instant forward, and take a whole-minute int.
                    $elapsedMinutes = (int) $pickedUpAt->diffInMinutes(now());

                    // Estimate expected duration based on distance (rough: 2 min/km for motorcycle, 3 min/km for car)
                    $distanceKm = (float) ($booking->distance_km ?? 5);
                    $estimatedMinutes = $distanceKm * 3; // Conservative estimate

                    if ($estimatedMinutes < 5) {
                        $estimatedMinutes = 5; // Minimum 5 minutes
                    }

                    $threshold = $estimatedMinutes * $multiplier;

                    if ($elapsedMinutes > $threshold) {
                        // Check if we already sent an alert for this booking
                        $cacheKey = "ride_duration_alert:{$booking->id}";
                        if (cache()->has($cacheKey)) {
                            continue;
                        }

                        Log::warning("Ride duration alert for booking {$booking->id}: {$elapsedMinutes}min elapsed, threshold {$threshold}min");

                        // RideDurationAlert's constructor takes a Booking instance
                        // (not an id) — passing $booking->id here threw a TypeError,
                        // so the alert never actually dispatched.
                        event(new RideDurationAlert(
                            $booking,
                            $elapsedMinutes,
                            (int) $estimatedMinutes
                        ));

                        // Prevent duplicate alerts for 30 minutes
                        cache()->put($cacheKey, true, 1800);
                    }
                }
            });
    }
}
