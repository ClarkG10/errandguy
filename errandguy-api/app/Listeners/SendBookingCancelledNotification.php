<?php

namespace App\Listeners;

use App\Events\BookingCancelled;
use App\Services\NotificationService;

class SendBookingCancelledNotification
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
                'Booking Cancelled',
                "Your errand #{$number} has been cancelled.",
                [
                    'type' => 'booking_update',
                    'booking_id' => $booking->id,
                    'status' => 'cancelled',
                ]
            );
        }

        // Notify runner if one was assigned
        if ($booking->runner_id) {
            $this->notificationService->sendPush(
                $booking->runner_id,
                'Booking Cancelled',
                "Errand #{$number} has been cancelled by the customer.",
                [
                    'type' => 'booking_update',
                    'booking_id' => $booking->id,
                    'status' => 'cancelled',
                ]
            );
        }
    }
}
