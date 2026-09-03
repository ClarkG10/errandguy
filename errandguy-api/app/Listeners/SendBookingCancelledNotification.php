<?php

namespace App\Listeners;

use App\Events\BookingCancelled;
use App\Services\NotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;

class SendBookingCancelledNotification implements ShouldQueue
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function handle(BookingCancelled $event): void
    {
        $booking = $event->booking;
        $number = $booking->booking_number ?? $booking->id;

        // Notify customer
        if ($booking->customer_id) {
            $this->notificationService->sendPush(
                $booking->customer_id,
                // Sentence case, and the object is an "errand" — matching
                // SendBookingStatusNotification::TEMPLATES and the app's
                // `constants/copy.ts`. This was the last push title that
                // arrived Title Case and renamed the thing mid-flow: an
                // Alerts inbox showed "Your errand #x is on the way" and
                // then "Booking Cancelled" for the very same errand.
                'Errand cancelled',
                "Your errand #{$number} has been cancelled.",
                [
                    'type' => 'booking_update',
                    'booking_id' => $booking->id,
                    'status' => 'cancelled',
                ]
            );
        }

        // Notify runner if one was assigned. Keep the cause NEUTRAL: this same
        // event fires for admin/platform cancellations (BookingService::adminCancel)
        // of in-progress bookings, where "by the customer" is false and would make
        // a mid-errand runner wrongly blame the customer for an ops/fraud/dispute
        // cancel. The customer gets their own (already cause-neutral) notice above.
        if ($booking->runner_id) {
            $this->notificationService->sendPush(
                $booking->runner_id,
                'Errand cancelled',
                "Errand #{$number} has been cancelled.",
                [
                    'type' => 'booking_update',
                    'booking_id' => $booking->id,
                    'status' => 'cancelled',
                ]
            );
        }
    }
}
