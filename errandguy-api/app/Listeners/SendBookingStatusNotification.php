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
        $status = $event->newStatus;

        // Bookings share three flows (standard / transport / single-location),
        // but the base TEMPLATES are written for the physical pickup→deliver
        // flow — so copy like "Item Picked Up … on the way" is wrong for a ride,
        // a bill payment or a queue job. Layer a per-errand-type override on top
        // of the status template: the override wins per recipient, otherwise we
        // fall back to the base. Keyed by errand_type slug.
        $base = self::TEMPLATES[$status] ?? [];
        $slug = $booking->errandType?->slug;
        $override = $slug ? (self::TYPE_OVERRIDES[$slug][$status] ?? []) : [];

        $customer = $override['customer'] ?? $base['customer'] ?? null;
        $runner = $override['runner'] ?? $base['runner'] ?? null;

        if (!$customer && !$runner) {
            return;
        }

        $number = $booking->booking_number ?? $booking->id;
        $data = [
            'type' => 'booking_update',
            'booking_id' => $booking->id,
            'status' => $status,
        ];

        if ($customer && $booking->customer_id) {
            $this->notificationService->sendPush(
                $booking->customer_id,
                $customer['title'],
                str_replace('{number}', $number, $customer['body']),
                $data,
            );
        }

        if ($runner && $booking->runner_id) {
            $this->notificationService->sendPush(
                $booking->runner_id,
                $runner['title'],
                str_replace('{number}', $number, $runner['body']),
                $data,
            );
        }
    }

    /**
     * Per-errand-type copy overrides, keyed by errand_type slug → status →
     * recipient. The base TEMPLATES below describe the physical delivery flow;
     * these correct the wording for the flows where a status means something
     * different (a passenger ride, a bill payment, a queue job). Any status not
     * listed here for a type simply uses the base template.
     */
    private const TYPE_OVERRIDES = [
        // Passenger ride (transport flow — skips `delivered`).
        'transportation' => [
            'heading_to_pickup' => [
                'customer' => ['title' => 'Driver on the way', 'body' => 'Your driver is heading to your pickup point.'],
            ],
            'arrived_at_pickup' => [
                'customer' => ['title' => 'Driver has arrived', 'body' => 'Your driver is waiting at the pickup point.'],
            ],
            'picked_up' => [
                'customer' => ['title' => 'Ride started', 'body' => 'You’re on your way to your destination.'],
            ],
            'arrived_at_dropoff' => [
                'customer' => ['title' => 'You’ve arrived', 'body' => 'You’ve reached your destination.'],
            ],
            'completed' => [
                'customer' => ['title' => 'Trip complete', 'body' => 'Your trip #{number} is complete. Thanks for riding with ErrandGuy!'],
                'runner' => ['title' => 'Trip complete', 'body' => 'Trip #{number} completed. Payment will be processed.'],
            ],
        ],
        // Bills payment (single-location flow — accepted → … → picked_up → completed).
        'bills_payment' => [
            'arrived_at_pickup' => [
                'customer' => ['title' => 'At the payment counter', 'body' => 'Your runner is paying your bill now.'],
            ],
            'picked_up' => [
                'customer' => ['title' => 'Bill paid', 'body' => 'Your bill has been paid — your receipt will be shared shortly.'],
            ],
            'completed' => [
                'customer' => ['title' => 'All done', 'body' => 'Your bills-payment errand #{number} is complete.'],
            ],
        ],
        // Queue / fall-in-line (single-location flow).
        'queue' => [
            'arrived_at_pickup' => [
                'customer' => ['title' => 'In line for you', 'body' => 'Your runner is now waiting in line.'],
            ],
            'picked_up' => [
                'customer' => ['title' => 'At the front', 'body' => 'Your runner has reached the front of the line.'],
            ],
            'completed' => [
                'customer' => ['title' => 'All done', 'body' => 'Your queue errand #{number} is complete.'],
            ],
        ],
    ];

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
