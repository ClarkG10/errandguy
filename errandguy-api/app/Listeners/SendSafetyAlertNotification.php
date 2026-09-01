<?php

namespace App\Listeners;

use App\Events\RideDurationAlert;
use App\Events\RouteDeviationAlert;
use App\Models\AdminAlert;
use App\Services\NotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class SendSafetyAlertNotification implements ShouldQueue
{
    /**
     * Once-per-booking guard on the outward half of a duration alert.
     *
     * CheckRideDurationJob re-fires every 30 minutes for as long as a trip stays
     * over its estimate (its own `ride_duration_alert:{id}` flag), which is the
     * right cadence for a LOG trail but not for buzzing two phones and stacking
     * duplicate rows in the operator feed. Longer than any plausible trip, so a
     * single overrun yields a single alert and a single nudge; a queued-listener
     * retry can't double-send either.
     */
    private const ALERT_FLAG_TTL_SECONDS = 21600; // 6 hours

    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function handleDurationAlert(RideDurationAlert $event): void
    {
        $booking = $event->booking;

        Log::warning("Safety: Booking {$booking->id} exceeded estimated duration. Elapsed: {$event->elapsedMinutes}min, Estimated: {$event->estimatedMinutes}min");

        // Everything below used to be a log line plus an SMS path with no
        // provider behind it, so the detection reached no human at all: no
        // operator alert, and neither the customer (who is the one wondering)
        // nor the runner (who could explain in one tap) was told. Claim-then-
        // send so a listener retry or a re-fire 30 minutes later stays quiet.
        if (Cache::add("ride_duration_notified:{$booking->id}", true, self::ALERT_FLAG_TTL_SECONDS)) {
            // Operator feed (LiveAlertsWidget). Best-effort by design —
            // AdminAlert::raise swallows its own failures.
            AdminAlert::raise(
                'ride_duration',
                'warning',
                'Trip running long',
                'Booking '.($booking->booking_number ?? $booking->id)
                    ." is {$event->elapsedMinutes} min in against a {$event->estimatedMinutes} min estimate.",
                $booking->id,
            );

            $this->notifyParties($event);
        }

        $this->notifyTrustedContacts(
            $booking->customer_id,
            'Duration Alert',
            "An errand for your contact is taking longer than expected ({$event->elapsedMinutes} min vs {$event->estimatedMinutes} min estimated)."
        );
    }

    public function handleRouteDeviation(RouteDeviationAlert $event): void
    {
        $booking = $event->booking;
        $deviationKm = round($event->deviationMeters / 1000, 2);

        Log::warning("Safety: Booking {$booking->id} route deviation of {$deviationKm}km detected.");

        $this->notifyTrustedContacts(
            $booking->customer_id,
            'Route Deviation Alert',
            "An errand for your contact has deviated {$deviationKm}km from the expected route."
        );
    }

    /**
     * Tell both sides of the booking, asymmetrically on purpose.
     *
     * The customer gets notifyInApp — a persisted row plus the live
     * `notifications.{userId}` Reverb broadcast, so it lands on the tracking
     * screen they are almost certainly already staring at, WITHOUT a device
     * buzz. The detector is a heuristic (2x a rough distance estimate), and a
     * false "your trip is late" that wakes a phone is worse than the silence it
     * replaces; the same reasoning drives SendBookingStatusNotification's
     * SILENT_STATUSES.
     *
     * The runner gets sendPush — they are the one who must act, they are on the
     * road with the app backgrounded, and the whole point is a nudge to send the
     * customer one line of explanation.
     */
    private function notifyParties(RideDurationAlert $event): void
    {
        $booking = $event->booking;

        // The only producer today is CheckRideDurationJob, which is scoped to
        // is_transportation — but keep the copy correct if it is ever broadened.
        $noun = $booking->is_transportation ? 'ride' : 'errand';
        $pro = $booking->is_transportation ? 'driver' : 'runner';

        $data = [
            'type' => 'booking_update',
            'booking_id' => $booking->id,
            'status' => $booking->status,
            'reason' => 'duration_alert',
        ];

        if ($booking->customer_id) {
            $this->notificationService->notifyInApp(
                $booking->customer_id,
                "This {$noun} is running long",
                "Your {$noun} has passed its estimated time. We've nudged your {$pro} for an update — tap to message them.",
                $data,
            );
        }

        if ($booking->runner_id) {
            $this->notificationService->sendPush(
                $booking->runner_id,
                'Running long?',
                "This {$noun} has passed its estimated time. Send your customer a quick update so they know what's happening.",
                $data,
            );
        }
    }

    private function notifyTrustedContacts(string $customerId, string $title, string $body): void
    {
        $contacts = \App\Models\TrustedContact::where('user_id', $customerId)->get();

        foreach ($contacts as $contact) {
            if ($contact->phone) {
                // Do NOT log the contact's phone (third-party PII) or the alert
                // body — emit a non-sensitive breadcrumb only, mirroring
                // NotifySosContactsJob::notifySMSContact.
                Log::info('Safety-alert SMS pending (no SMS provider configured)', [
                    'customer_id' => $customerId,
                    'contact_id' => $contact->id,
                    'alert' => $title,
                ]);
                // TODO: Integrate SMS provider for trusted contact alerts
            }
        }
    }
}
