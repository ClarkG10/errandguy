<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Services\MatchingService;
use App\Services\NotificationService;
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

    public function handle(MatchingService $matchingService, NotificationService $notifications): void
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
            'type' => 'booking_update',
            'booking_id' => $booking->id,
            'booking_number' => $booking->booking_number,
            'errand_type' => $booking->errandType?->slug,
            'pickup_address' => $booking->pickup_address,
            'dropoff_address' => $booking->dropoff_address,
            'customer_offer' => $booking->customer_offer,
            'pricing_mode' => $booking->pricing_mode,
            'negotiate_expires_at' => optional($booking->negotiate_expires_at)->toIso8601String(),
        ];

        // Persist + broadcast an in-app offer to each nearby runner over their
        // `notifications.{userId}` Reverb channel. This replaces the old bulk
        // realtime table insert (whose table the app no longer subscribes
        // to). notifyInApp is broadcast-only — no device push — preserving the
        // prior behaviour (the "push fallback" TODO below was never wired).
        // This job is queued/off-request, so per-runner inserts are fine.
        foreach ($runners as $runner) {
            $notifications->notifyInApp(
                $runner->user_id,
                'New Errand Request',
                'A new errand is available near you.',
                $payload,
            );
        }

        Log::info("BroadcastToRunnersJob: notified {$runners->count()} runners for booking {$this->bookingId}");

        // TODO (push fallback): when a runner has the app backgrounded, the
        // WebSocket is suspended on iOS. Add an FCM/APNs send here (or switch
        // the call above to sendPush) once we want offers to wake the device.
    }
}
