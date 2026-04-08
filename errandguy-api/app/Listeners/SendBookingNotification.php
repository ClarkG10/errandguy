<?php

namespace App\Listeners;

use App\Events\BookingStatusChanged;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

class SendBookingNotification implements ShouldQueue
{
    public function handle(BookingStatusChanged $event): void
    {
        $booking = $event->booking->load(['customer', 'runner']);
        $newStatus = $event->newStatus;

        Log::info("Booking {$booking->id} status changed: {$event->oldStatus} → {$newStatus}");

        // Notify customer
        if ($booking->customer && $booking->customer->fcm_token) {
            $this->sendPushNotification(
                $booking->customer->fcm_token,
                $this->getCustomerNotificationTitle($newStatus),
                $this->getCustomerNotificationBody($booking, $newStatus)
            );
        }

        // Notify runner (if applicable)
        if ($booking->runner && $booking->runner->fcm_token && in_array($newStatus, ['cancelled'])) {
            $this->sendPushNotification(
                $booking->runner->fcm_token,
                'Booking Cancelled',
                "Booking {$booking->booking_number} has been cancelled."
            );
        }
    }

    private function getCustomerNotificationTitle(string $status): string
    {
        return match ($status) {
            'matched' => 'Runner Found!',
            'accepted' => 'Runner Accepted',
            'picked_up' => 'Errand In Progress',
            'in_transit' => 'On the Way',
            'arrived' => 'Runner Arrived',
            'completed' => 'Errand Completed',
            'cancelled' => 'Booking Cancelled',
            'no_runner' => 'No Runner Available',
            default => 'Booking Update',
        };
    }

    private function getCustomerNotificationBody(mixed $booking, string $status): string
    {
        $bookingNumber = $booking->booking_number;

        return match ($status) {
            'matched' => "A runner has been matched to your errand {$bookingNumber}.",
            'accepted' => "Your runner is on the way for errand {$bookingNumber}.",
            'picked_up' => "Your errand {$bookingNumber} has been picked up.",
            'in_transit' => "Your errand {$bookingNumber} is on the way to delivery.",
            'arrived' => "Your runner has arrived at the destination for {$bookingNumber}.",
            'completed' => "Your errand {$bookingNumber} has been completed!",
            'cancelled' => "Your booking {$bookingNumber} has been cancelled.",
            'no_runner' => "No runners are available for {$bookingNumber}. Try again later.",
            default => "Your booking {$bookingNumber} has been updated.",
        };
    }

    private function sendPushNotification(string $fcmToken, string $title, string $body): void
    {
        // TODO: Integrate with Firebase Cloud Messaging (FCM) HTTP v1 API
        Log::info("Push notification: [{$title}] {$body} → token: " . substr($fcmToken, 0, 20) . '...');
    }
}
