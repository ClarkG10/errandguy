<?php

namespace App\Listeners;

use App\Events\RideDurationAlert;
use App\Events\RouteDeviationAlert;
use App\Services\NotificationService;
use Illuminate\Support\Facades\Log;

class SendSafetyAlertNotification
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function handleDurationAlert(RideDurationAlert $event): void
    {
        $booking = $event->booking;

        Log::warning("Safety: Booking {$booking->id} exceeded estimated duration. Elapsed: {$event->elapsedMinutes}min, Estimated: {$event->estimatedMinutes}min");

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

    private function notifyTrustedContacts(string $customerId, string $title, string $body): void
    {
        $contacts = \App\Models\TrustedContact::where('user_id', $customerId)->get();

        foreach ($contacts as $contact) {
            if ($contact->phone) {
                Log::info("Safety SMS to {$contact->phone}: [{$title}] {$body}");
                // TODO: Integrate SMS provider for trusted contact alerts
            }
        }
    }
}
