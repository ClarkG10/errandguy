<?php

namespace App\Listeners;

use App\Events\BookingStatusChanged;
use App\Models\Booking;
use App\Services\NotificationService;
use App\Support\CancellationNotice;
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

        // Bookings share two flows (standard / single-location), but the base
        // TEMPLATES are written for the physical pickup→deliver flow — so copy
        // like "Item Picked Up … on the way" is wrong for a queue job. Layer a
        // per-errand-type override on top of the status template: the override
        // wins per recipient, otherwise we fall back to the base. Keyed by
        // errand_type slug.
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
        // refundClause; `{next}` is what the customer can do about it.
        // `{item_cash}` is the "Buy for me" repayment line (itemCashLine).
        // Anything else resolves to '' so the surrounding copy reads correctly
        // with the sentence simply absent.
        $placeholders = [
            '{number}' => (string) $number,
            '{refund}' => $this->refundClause($booking, $status),
            '{next}' => $this->nextStep($booking, $status),
            '{item_cash}' => self::itemCashLine($booking),
            '{receipt}' => $status === 'completed' ? self::receiptLine($booking) : '',
            '{runner_pay}' => $status === 'completed' ? self::runnerPayLine($booking) : '',
        ];

        // Quiet stages get the in-app row + live Reverb update, but no device
        // buzz. See SILENT_STATUSES — nothing is lost from the inbox or the
        // tracking screen, only the interruption. They land already read: the
        // customer is watching the errand move, and progress nobody was
        // interrupted for shouldn't leave the unread badge at "9+" after one
        // errand.
        $deliver = in_array($status, self::SILENT_STATUSES, true)
            ? fn (string $userId, string $title, string $body) => $this->notificationService
                ->notifyInApp($userId, $title, $body, $data, read: true)
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
     * The money sentence for a matching failure (empty for any other status).
     *
     * MatchRunnerJob fires BookingStatusChanged('no_runner') and THEN calls
     * BookingService::refundUnfulfilled (post-commit, idempotent, own lock), and
     * this listener is queued — so it can run either side of that refund.
     * CancellationNotice::money re-reads the CURRENT payment_status and only
     * claims what is true for it: returned to the wallet, being returned, or —
     * for a cash / unpaid errand that collected nothing — not charged.
     */
    private function refundClause(Booking $booking, string $status): string
    {
        if ($status !== 'no_runner') {
            return '';
        }

        return ' '.CancellationNotice::money($booking);
    }

    /**
     * After "no runner": a cash (or otherwise uncollected) errand can simply be
     * searched again, but one whose money was refunded — or is being refunded
     * right now — can't (BookingService::retryBlockReason), so the customer is
     * pointed at booking it again instead of a "try again" that is refused.
     */
    private function nextStep(Booking $booking, string $status): string
    {
        if ($status !== 'no_runner') {
            return '';
        }

        $paymentStatus = Booking::whereKey($booking->id)->value('payment_status') ?? $booking->payment_status;

        return in_array($paymentStatus, ['paid', 'refunded'], true)
            ? ' Tap to book it again.'
            : ' Tap to try again.';
    }

    /**
     * "Buy for me": the runner pays for the items out of pocket and the
     * customer repays them in cash at the door, so the customer is told the
     * amount to have ready — what the runner reported paying, or, before they
     * have, the budget the customer set. On a cash errand the fare is collected
     * at the door too (the runner is told to collect both —
     * BookingResource::amountToCollectFor), so it is in the amount: the item
     * money alone left the customer short at the door.
     */
    private static function itemCashLine(Booking $booking): string
    {
        $fare = ($booking->payment_method === 'cash' && $booking->payment_status !== 'paid')
            ? round((float) $booking->total_amount, 2)
            : 0.0;
        $peso = fn (float $amount): string => '₱'.number_format($amount, 2);
        $split = fn (string $items): string => $fare > 0 ? ' ('.$items.' for the items + '.$peso($fare).' fare)' : '';

        $paid = round((float) $booking->actual_item_cost, 2);
        if ($paid > 0) {
            return 'Your runner paid '.$peso($paid).' for your items — please have '
                .$peso($paid + $fare).' cash ready'.$split($peso($paid)).'.';
        }

        $budget = round((float) $booking->shopping_budget, 2);
        if ($budget > 0) {
            return 'Your runner paid up to '.$peso($budget).' for your items — please have up to '
                .$peso($budget + $fare).' cash ready'.$split('up to '.$peso($budget)).'.';
        }

        return 'Your runner paid for your items — please have the cash ready to repay them'
            .($fare > 0 ? ', plus the '.$peso($fare).' fare.' : '.');
    }

    /**
     * The fare and how it was paid, for the customer's "completed" notice.
     * Empty when it wasn't settled (an online payment that never came through)
     * — nothing true to say about money there.
     */
    private static function receiptLine(Booking $booking): string
    {
        $how = match (true) {
            $booking->payment_method === 'cash' => 'paid in cash',
            $booking->payment_status !== 'paid' => null,
            $booking->payment_method === 'wallet' => 'paid from your ErrandGuy wallet',
            $booking->payment_method === 'gcash' => 'paid by GCash',
            $booking->payment_method === 'maya' => 'paid by Maya',
            default => 'paid',
        };

        return $how === null
            ? ''
            : ' The fare was ₱'.number_format((float) $booking->total_amount, 2).", {$how}.";
    }

    /**
     * What completing the errand did for the runner — read from the ledger
     * BookingSettlementService::settleCompletion just wrote, so it names what
     * actually moved. "Payment will be processed" was true for none of the
     * three outcomes.
     */
    private static function runnerPayLine(Booking $booking): string
    {
        $entry = \App\Models\WalletTransaction::where('user_id', $booking->runner_id)
            ->where('reference_id', $booking->id)
            ->whereIn('type', ['earning', 'commission'])
            ->first();
        $peso = fn (float $amount): string => '₱'.number_format(abs($amount), 2);

        return match ($entry?->type) {
            'earning' => $peso((float) $entry->amount).' was added to your ErrandGuy wallet.',
            'commission' => 'You keep the fare you collected in cash; ErrandGuy’s '
                .$peso((float) $entry->amount).' fee was taken from your wallet.',
            // settleCompletion credits nothing until the customer's payment
            // lands; backfillRunnerEarning adds it when it does.
            default => 'The customer’s payment hasn’t come through yet — your '
                .$peso((float) $booking->runner_payout).' is added to your wallet as soon as it does.',
        };
    }

    /**
     * "Buy for me" stages where the customer must have the item money ready.
     * Shared by the bookable shopping type and the retired food / grocery
     * types it replaced (errands booked before the retirement still run).
     */
    private const SHOPPING_STAGES = [
        'picked_up' => [
            'customer' => ['title' => 'Items bought', 'body' => '{item_cash}'],
        ],
        'arrived_at_dropoff' => [
            'customer' => ['title' => 'Arrived at drop-off', 'body' => 'Your runner has arrived. {item_cash}'],
        ],
    ];

    /**
     * Per-errand-type copy overrides, keyed by errand_type slug → status →
     * recipient. The base TEMPLATES below describe the physical delivery flow;
     * these correct the wording for the flows where a status means something
     * different (a queue job). Any status not listed here for a type simply
     * uses the base template.
     */
    private const TYPE_OVERRIDES = [
        // "Buy for me" (and the food / grocery types it replaced).
        'purchase' => self::SHOPPING_STAGES,
        'food' => self::SHOPPING_STAGES,
        'grocery' => self::SHOPPING_STAGES,
        // Queue / fall-in-line (single-location flow).
        'queue' => [
            'no_runner' => [
                'customer' => ['title' => 'No runner available', 'body' => 'We couldn’t find a runner to line up for #{number}.{refund}{next}'],
            ],
            'arrived_at_pickup' => [
                'customer' => ['title' => 'In line for you', 'body' => 'Your runner is now waiting in line.'],
            ],
            'picked_up' => [
                'customer' => ['title' => 'At the front', 'body' => 'Your runner has reached the front of the line.'],
            ],
            'completed' => [
                'customer' => ['title' => 'All done', 'body' => 'Your queue errand #{number} is complete.{receipt}'],
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
        // No 'matched' notice: it is only an offer the runner may decline (an
        // errand can be offered to several runners in turn), so "Runner found"
        // rows piled up before "No runner available". The customer hears when a
        // runner accepts.
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
                'body' => 'Your errand #{number} has been completed.{receipt}',
            ],
            'runner' => [
                'title' => 'Errand completed',
                'body' => 'Errand #{number} completed. {runner_pay}',
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
                'body' => 'We couldn’t find a runner for errand #{number}.{refund}{next}',
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
