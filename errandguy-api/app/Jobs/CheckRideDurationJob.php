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

        // Find active transportation bookings that are in transit
        $bookings = Booking::where('is_transportation', true)
            ->where('status', 'in_transit')
            ->whereNotNull('picked_up_at')
            ->where('sos_triggered', false)
            ->get();

        foreach ($bookings as $booking) {
            $pickedUpAt = $booking->picked_up_at;
            $elapsedMinutes = now()->diffInMinutes($pickedUpAt);

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

                event(new RideDurationAlert(
                    $booking->id,
                    $elapsedMinutes,
                    (int) $estimatedMinutes
                ));

                // Prevent duplicate alerts for 30 minutes
                cache()->put($cacheKey, true, 1800);
            }
        }
    }
}
