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

        // One bulk PostgREST insert for ALL nearby runners instead of a
        // sequential HTTP round-trip per runner — the old loop made create
        // latency scale with the number of eligible runners (and could stack
        // N Supabase timeouts). Each row fans out to that runner's realtime
        // subscription on the `notifications` table exactly as before.
        $notifications = $runners->map(fn ($runner) => [
            'user_id' => $runner->user_id,
            'title' => 'New Errand Request',
            'body' => 'A new errand is available near you.',
            'type' => 'booking_update',
            'data' => $payload,
        ])->all();

        $delivered = $realtime->insertNotifications($notifications);

        Log::info("BroadcastToRunnersJob: notified {$delivered}/{$runners->count()} runners for booking {$this->bookingId}");

        // TODO (push fallback): when a runner has the app backgrounded, the
        // realtime channel is suspended on iOS. Add an FCM/APNs send here
        // once the device-token table is wired up.
    }
}
