<?php

namespace App\Listeners;

use App\Events\BookingCreated;
use App\Services\NotificationService;

class SendBookingCreatedNotification
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function handle(BookingCreated $event): void
    {
        $booking = $event->booking;
        $number = $booking->booking_number ?? $booking->id;

        $this->notificationService->sendPush(
            $booking->customer_id,
            'Booking Confirmed',
            "Your errand #{$number} has been placed. Looking for a runner...",
            [
                'type' => 'booking_update',
                'booking_id' => $booking->id,
                'status' => 'pending',
            ]
        );
    }
}
