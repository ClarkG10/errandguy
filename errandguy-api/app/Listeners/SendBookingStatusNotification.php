<?php

namespace App\Listeners;

use App\Events\BookingStatusChanged;
use App\Services\NotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;

class SendBookingStatusNotification implements ShouldQueue
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
        // The four flow statuses below previously had NO listener template and
        // relied on a direct Notification::create in RunnerErrandController
        // (removed to stop the duplicate in-app row). Templated here so each
        // still notifies the customer — now via the single listener path.
        'heading_to_pickup' => [
            'customer' => [
                'title' => 'On the Way',
                'body' => 'Your runner is on the way to the pickup location.',
            ],
        ],
        'in_transit' => [
            'customer' => [
                'title' => 'In Transit',
                'body' => 'Your errand #{number} is on the way to the destination.',
            ],
        ],
        'arrived_at_dropoff' => [
            'customer' => [
                'title' => 'Arrived at Drop-off',
                'body' => 'Your runner has arrived at the drop-off location.',
            ],
        ],
        'delivered' => [
            'customer' => [
                'title' => 'Delivered',
                'body' => 'Your errand #{number} has been delivered.',
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
