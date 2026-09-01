<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Models\Notification;
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

        // 'incoming_request' (NOT 'booking_update'): this is a broadcast OFFER the
        // runner has not accepted, so runner_id is still null. Typing it
        // 'booking_update' made the in-app tap route to the owner-only errand
        // cockpit, which 404s for a booking that isn't theirs. 'incoming_request'
        // routes both the in-app row and the paired device push (below) to the
        // runner's offers home. (RT-4)
        $payload = [
            'type' => 'incoming_request',
            'booking_id' => $booking->id,
            'booking_number' => $booking->booking_number,
            'errand_type' => $booking->errandType?->slug,
            'pickup_address' => $booking->pickup_address,
            'dropoff_address' => $booking->dropoff_address,
            'customer_offer' => $booking->customer_offer,
            'pricing_mode' => $booking->pricing_mode,
            'negotiate_expires_at' => optional($booking->negotiate_expires_at)->toIso8601String(),
        ];

        // Each nearby runner gets TWO things: (1) an in-app offer card persisted
        // + broadcast over their `notifications.{userId}` Reverb channel (live
        // when the app is open), and (2) a device push to WAKE a backgrounded
        // app — with no second inbox row, and a tap that opens their offers
        // home.
        //
        // Both are done in BULK for the whole audience (up to 200 runners). The
        // old shape was a per-runner loop of 2 queries + a blocking Expo HTTP
        // round trip each, so runner #1's phone lit up immediately and runner
        // #150's tens of seconds later — usually after the errand was taken —
        // while this single job held the queue worker hostage (and risked its
        // 60s timeout) ahead of every other queued push on the platform.
        //
        // De-dupe the recipient list first: the per-runner path was implicitly
        // dedup'd by its own existence check, the bulk insert is not.
        $runnerUserIds = $runners->pluck('user_id')->filter()->unique()->values()->all();

        // Idempotent in-app OFFER: exactly one 'incoming_request' card per
        // (runner, booking), no matter how many times this job re-runs — a
        // queue retry, a worker crash mid-loop, or the admin "stuck errand"
        // re-dispatch (BookingService::adminRematch). notifyInAppMany() does an
        // unconditional insert with no dedup, so guard it here — ONE grouped
        // query for the whole audience instead of one per runner. A duplicate
        // device push is acceptable; a duplicate inbox card is not. (mirrors
        // the fixed-match dedup in MatchRunnerJob)
        $alreadyOffered = Notification::whereIn('user_id', $runnerUserIds)
            ->where('type', 'incoming_request')
            ->where('data->booking_id', $booking->id)
            ->pluck('user_id')
            ->all();

        $needsCard = array_values(array_diff($runnerUserIds, $alreadyOffered));

        if (! empty($needsCard)) {
            $notifications->notifyInAppMany(
                $needsCard,
                'New Errand Request',
                'A new errand is available near you.',
                $payload,
            );
        }

        // One device fan-out for everybody: 2 queries + ceil(devices / 100)
        // Expo requests, and every runner's phone rings at the same moment.
        $notifications->sendRemotePushToMany(
            $runnerUserIds,
            'New errand nearby',
            'A new errand is available near you. Tap to view the offer.',
            ['type' => 'incoming_request', 'booking_id' => $booking->id],
        );

        Log::info('BroadcastToRunnersJob: notified ' . count($runnerUserIds) . " runners for booking {$this->bookingId}");
    }
}
