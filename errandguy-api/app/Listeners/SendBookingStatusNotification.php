<?php

namespace App\Listeners;

use App\Events\BookingStatusChanged;
use App\Services\NotificationService;

class SendBookingStatusNotification
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function handle(BookingStatusChanged $event): void
    {
        $booking = $event->booking;
        $templates = self::TEMPLATES[$event->newStatus] ?? null;

        if (!$templates) {
            return;
        }

        $number = $booking->booking_number ?? $booking->id;

        if (isset($templates['customer']) && $booking->customer_id) {
            $this->notificationService->sendPush(
                $booking->customer_id,
                $templates['customer']['title'],
                str_replace('{number}', $number, $templates['customer']['body']),
                [
                    'type' => 'booking_update',
                    'booking_id' => $booking->id,
                    'status' => $event->newStatus,
                ]
            );
        }

        if (isset($templates['runner']) && $booking->runner_id) {
            $this->notificationService->sendPush(
                $booking->runner_id,
                $templates['runner']['title'],
                str_replace('{number}', $number, $templates['runner']['body']),
                [
                    'type' => 'booking_update',
                    'booking_id' => $booking->id,
                    'status' => $event->newStatus,
                ]
            );
        }
    }

    private const TEMPLATES = [
        'matched' => [
            'customer' => [
                'title' => 'Runner Found!',
                'body' => 'A runner has been matched for booking #{number}.',
            ],
        ],
        'accepted' => [
            'customer' => [
                'title' => 'Runner Assigned!',
                'body' => 'Your runner is heading to the pickup location.',
            ],
        ],
        'arrived_at_pickup' => [
            'customer' => [
                'title' => 'Runner Arrived',
                'body' => 'Your runner has arrived at the pickup location.',
            ],
        ],
        'picked_up' => [
            'customer' => [
                'title' => 'Item Picked Up',
                'body' => 'Your item has been picked up and is on the way.',
            ],
        ],
        'completed' => [
            'customer' => [
                'title' => 'Errand Completed!',
                'body' => 'Your errand #{number} has been completed.',
            ],
            'runner' => [
                'title' => 'Errand Completed',
                'body' => 'Errand #{number} completed. Payment will be processed.',
            ],
        ],
        'cancelled' => [
            'customer' => [
                'title' => 'Booking Cancelled',
                'body' => 'Booking #{number} has been cancelled.',
            ],
            'runner' => [
                'title' => 'Booking Cancelled',
                'body' => 'Booking #{number} was cancelled by the customer.',
            ],
        ],
    ];
}
