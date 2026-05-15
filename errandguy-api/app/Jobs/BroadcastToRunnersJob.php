<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Services\MatchingService;
use App\Services\RealtimeService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class BroadcastToRunnersJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public string $bookingId,
    ) {}

    public function handle(MatchingService $matchingService, RealtimeService $realtime): void
    {
        $runners = $matchingService->broadcastToRunners($this->bookingId);

        if ($runners->isEmpty()) {
            Log::info("BroadcastToRunnersJob: no eligible runners for booking {$this->bookingId}");
            return;
        }

        // Eager-load minimal booking data so each notification carries enough
        // context for the mobile app to render an offer card without a refetch.
        $booking = Booking::with('errandType')->find($this->bookingId);
        if (!$booking) {
            Log::warning("BroadcastToRunnersJob: booking {$this->bookingId} not found");
            return;
        }

        $payload = [
            'booking_id' => $booking->id,
            'booking_number' => $booking->booking_number,
            'errand_type' => $booking->errandType?->slug,
            'pickup_address' => $booking->pickup_address,
            'dropoff_address' => $booking->dropoff_address,
            'customer_offer' => $booking->customer_offer,
            'pricing_mode' => $booking->pricing_mode,
            'negotiate_expires_at' => optional($booking->negotiate_expires_at)->toIso8601String(),
        ];

        $delivered = 0;
        foreach ($runners as $runner) {
            // Each insert hits Supabase via REST → fans out to that runner's
            // realtime subscription on the `notifications` table. This is
            // what flips a polling-only flow into an instant push.
            try {
                $realtime->broadcastIncomingRequest($runner->user_id, $payload);
                $delivered++;
            } catch (\Throwable $e) {
                Log::warning('BroadcastToRunnersJob: failed to notify runner', [
                    'runner_id' => $runner->user_id,
                    'booking_id' => $this->bookingId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        Log::info("BroadcastToRunnersJob: notified {$delivered}/{$runners->count()} runners for booking {$this->bookingId}");

        // TODO (push fallback): when a runner has the app backgrounded, the
        // realtime channel is suspended on iOS. Add an FCM/APNs send here
        // once the device-token table is wired up.
    }
}
