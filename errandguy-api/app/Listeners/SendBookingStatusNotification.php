<?php

namespace App\Listeners;

use App\Events\BookingStatusChanged;
use App\Models\Booking;
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

        // Body placeholders. `{refund}` is only ever non-empty on a status that
        // auto-refunds (no_runner) AND where money was actually collected — see
        // refundClause. Anything else resolves to '' so the surrounding copy
        // reads correctly with the sentence simply absent.
        $placeholders = [
            '{number}' => (string) $number,
            '{refund}' => $this->refundClause($booking, $status),
        ];

        // Quiet stages get the in-app row + live Reverb update, but no device
        // buzz. See SILENT_STATUSES — nothing is lost from the inbox or the
        // tracking screen, only the interruption.
        $deliver = in_array($status, self::SILENT_STATUSES, true)
            ? fn (string $userId, string $title, string $body) => $this->notificationService
                ->notifyInApp($userId, $title, $body, $data)
            : fn (string $userId, string $title, string $body) => $this->notificationService
                ->sendPush($userId, $title, $body, $data);

        if ($customer && $booking->customer_id) {
            $deliver(
                $booking->customer_id,
                $customer['title'],
                strtr($customer['body'], $placeholders),
            );
        }

        if ($runner && $booking->runner_id) {
            $deliver(
                $booking->runner_id,
                $runner['title'],
                strtr($runner['body'], $placeholders),
            );
        }
    }

    /**
     * Stages that notify IN-APP ONLY (persisted row + `notifications.{userId}`
     * Reverb broadcast) instead of also waking the device.
     *
     * A standard delivery walks nine templated stages, and the runner advances
     * each one with its own tap — so the customer's phone buzzed nine times for
     * one errand, several of them saying the same thing seconds apart:
     *
     *   - 'matched' is an internal assignment; 'accepted' follows within
     *     seconds with the message that actually matters. (If the runner never
     *     accepts, ExpireStaleMatchesJob quietly re-matches — the customer
     *     should never have been buzzed for a runner who evaporates.)
     *   - 'heading_to_pickup' repeats 'accepted' almost verbatim ("your runner
     *     is heading to the pickup location").
     *   - 'in_transit' repeats 'picked_up' ("…and is on the way").
     *   - 'delivered' is immediately followed by 'completed'.
     *
     * What still buzzes is what the customer must act on or genuinely wants to
     * be interrupted for: accepted, arrived_at_pickup, picked_up,
     * arrived_at_dropoff, completed, no_runner, cancelled — plus the separate
     * server-side "your runner is nearby" approach push. Nine buzzes become
     * five, and the arrival alerts stop drowning in their own noise.
     */
    private const SILENT_STATUSES = [
        'matched',
        'heading_to_pickup',
        'in_transit',
        'delivered',
    ];

    /**
     * The refund sentence for a matching failure — empty unless money really was
     * (or is being) returned.
     *
     * MatchRunnerJob fires BookingStatusChanged('no_runner') and THEN calls
     * BookingService::refundUnfulfilled (post-commit, idempotent, own lock), and
     * this listener is queued — so it can run either side of that refund. We
     * therefore re-read the CURRENT payment_status and only claim what is true
     * for it: 'refunded' = done, 'paid' = in flight. A cash / unpaid errand
     * collected nothing (refundUnfulfilled no-ops there), so it gets no refund
     * promise at all. (A2 lifecycle gap)
     */
    private function refundClause(Booking $booking, string $status): string
    {
        if ($status !== 'no_runner') {
            return '';
        }

        $paymentStatus = Booking::whereKey($booking->id)->value('payment_status')
            ?? $booking->payment_status;
        $amount = '₱'.number_format((float) $booking->total_amount, 2);

        return match ($paymentStatus) {
            'refunded' => " {$amount} has been refunded to your ErrandGuy wallet.",
            'paid' => " Your {$amount} payment is being refunded to your ErrandGuy wallet.",
            default => '',
        };
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
            'no_runner' => [
                'customer' => ['title' => 'No driver available', 'body' => 'We couldn’t find a driver for trip #{number}.{refund} Tap to try booking again.'],
            ],
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
            'no_runner' => [
                'customer' => ['title' => 'No runner available', 'body' => 'We couldn’t find a runner to pay your bill for #{number}.{refund} Tap to try again.'],
            ],
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
            'no_runner' => [
                'customer' => ['title' => 'No runner available', 'body' => 'We couldn’t find a runner to line up for #{number}.{refund} Tap to try again.'],
            ],
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

    /**
     * Base status copy for the physical pickup→deliver flow.
     *
     * TITLES ARE SENTENCE CASE and the object is an "errand" — matching the
     * TYPE_OVERRIDES above, mobile's `constants/copy.ts` convention and the
     * in-app `STATUS_LABELS`. They used to be Title Case with exclamation
     * marks ("Runner Found!", "Item Picked Up"), so one customer's Alerts
     * inbox interleaved two casings for the same errand — the base templates
     * in one voice and the per-type overrides in another — and the same
     * object flipped names mid-flow ("Your errand #x is on the way" then
     * "Booking #x has been cancelled").
     */
    private const TEMPLATES = [
        'matched' => [
            'customer' => [
                'title' => 'Runner found',
                'body' => 'A runner has been matched for errand #{number}.',
            ],
        ],
        'accepted' => [
            'customer' => [
                'title' => 'Runner assigned',
                'body' => 'Your runner is heading to the pickup location.',
            ],
        ],
        // The four flow statuses below previously had NO listener template and
        // relied on a direct Notification::create in RunnerErrandController
        // (removed to stop the duplicate in-app row). Templated here so each
        // still notifies the customer — now via the single listener path.
        'heading_to_pickup' => [
            'customer' => [
                'title' => 'On the way',
                'body' => 'Your runner is on the way to the pickup location.',
            ],
        ],
        'in_transit' => [
            'customer' => [
                'title' => 'In transit',
                'body' => 'Your errand #{number} is on the way to the destination.',
            ],
        ],
        'arrived_at_dropoff' => [
            'customer' => [
                'title' => 'Arrived at drop-off',
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
                'title' => 'Runner arrived',
                'body' => 'Your runner has arrived at the pickup location.',
            ],
        ],
        'picked_up' => [
            'customer' => [
                'title' => 'Item picked up',
                'body' => 'Your item has been picked up and is on the way.',
            ],
        ],
        'completed' => [
            'customer' => [
                'title' => 'Errand completed',
                'body' => 'Your errand #{number} has been completed.',
            ],
            'runner' => [
                'title' => 'Errand completed',
                'body' => 'Errand #{number} completed. Payment will be processed.',
            ],
        ],
        // Matching exhausted every candidate. MatchRunnerJob already sets the
        // status, auto-refunds any money collected and raises an admin alert —
        // but with no template here the customer was told NOTHING and kept
        // staring at "Finding you a runner" (worse for a SCHEDULED booking,
        // matched minutes before its window with the customer out of the app).
        // The push's booking_update deep link lands on the tracking screen whose
        // no_runner receipt carries the one-tap "Book again". (A2 lifecycle gap)
        'no_runner' => [
            'customer' => [
                'title' => 'No runner available',
                'body' => 'We couldn’t find a runner for errand #{number}.{refund} Tap to try again.',
            ],
        ],
        // NOTE: unreachable today — no caller fires BookingStatusChanged with
        // 'cancelled' (every cancel path raises BookingCancelled instead, which
        // SendBookingCancelledNotification handles). Kept for the day a cancel
        // does flow through the status event, and worded like the rest of this
        // array so it cannot arrive in a third voice if it ever does.
        'cancelled' => [
            'customer' => [
                'title' => 'Errand cancelled',
                'body' => 'Errand #{number} has been cancelled.',
            ],
            'runner' => [
                'title' => 'Errand cancelled',
                'body' => 'Errand #{number} was cancelled by the customer.',
            ],
        ],
    ];
}
