<?php

namespace App\Listeners;

use App\Events\BookingCreated;
use App\Services\BookingService;
use App\Services\NotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;

class SendBookingCreatedNotification implements ShouldQueue
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function handle(BookingCreated $event): void
    {
        $booking = $event->booking;
        $number = $booking->booking_number ?? $booking->id;

        $data = [
            'type' => 'booking_update',
            'booking_id' => $booking->id,
            'status' => 'pending',
        ];

        // Sentence case, and the object is an "errand" — matching
        // SendBookingStatusNotification::TEMPLATES and the app's
        // `constants/copy.ts` ("Errand booked — finding you a runner.").
        // It used to read "Booking Confirmed", so the very first push a
        // customer ever received named the thing differently from every
        // screen and every push that followed it.
        $title = 'Errand booked';

        $scheduled = $booking->schedule_type === 'scheduled' && $booking->scheduled_at;
        // "Finding you a runner" would be a lie for a scheduled booking —
        // matching starts at scheduled_at−15min, so state the time the customer
        // actually booked, in THEIR timezone.
        $when = $scheduled
            ? $booking->scheduled_at
                ->copy()
                ->timezone((string) config('app.business_timezone', 'Asia/Manila'))
                ->format('D j M, g:i A')
            : null;

        // A GCash/Maya errand isn't searched for until its payment is
        // confirmed, so neither promise below holds yet. The customer is in
        // the payment flow right now: no buzz, just the in-app row. (Read when
        // this queued listener runs — a fast payment has usually landed by
        // then and gets the normal copy below.)
        if (BookingService::awaitingPayment($booking->fresh() ?? $booking)) {
            $this->notificationService->notifyInApp(
                $booking->customer_id,
                $title,
                $scheduled
                    ? "Your errand #{$number} is set for {$when} once your payment is confirmed."
                    : "Your errand #{$number} has been placed. We’ll start finding you a runner as soon as your payment is confirmed.",
                $data,
            );

            return;
        }

        // A `now` booking buzzes the phone of someone who tapped Confirm one
        // second ago and is watching the tracking screen say the same thing —
        // pure noise, and it lands right before the 'accepted' push that
        // actually matters. A SCHEDULED booking is the opposite: it may be
        // days out and the customer has every reason to close the app, so the
        // confirmation is the receipt they keep. In-app row + live Reverb
        // update either way — only the interruption differs.
        // (Same principle as SendBookingStatusNotification::SILENT_STATUSES.)
        if ($scheduled) {
            $this->notificationService->sendPush(
                $booking->customer_id,
                $title,
                "Your errand #{$number} is set for {$when}. We’ll find you a runner shortly before then.",
                $data,
            );

            return;
        }

        $this->notificationService->notifyInApp(
            $booking->customer_id,
            $title,
            "Your errand #{$number} has been placed — finding you a runner.",
            $data,
        );
    }
}
