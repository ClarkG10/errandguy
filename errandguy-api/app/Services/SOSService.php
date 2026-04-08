<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\SOSAlert;
use App\Models\TrustedContact;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class SOSService
{
    public function __construct(
        private NotificationService $notificationService,
        private RealtimeService $realtimeService,
    ) {}

    public function triggerSOS(string $bookingId, string $userId): SOSAlert
    {
        $booking = Booking::with(['runner.runnerProfile'])->findOrFail($bookingId);

        $runnerProfile = $booking->runner?->runnerProfile;

        $alert = SOSAlert::create([
            'booking_id' => $bookingId,
            'customer_id' => $userId,
            'runner_id' => $booking->runner_id,
            'triggered_at' => now(),
            'customer_lat' => $booking->dropoff_lat,
            'customer_lng' => $booking->dropoff_lng,
            'runner_lat' => $runnerProfile?->current_lat,
            'runner_lng' => $runnerProfile?->current_lng,
            'live_link_token' => Str::random(64),
            'live_link_expires_at' => now()->addMinutes(60),
            'status' => 'active',
        ]);

        $contacts = TrustedContact::where('user_id', $userId)
            ->orderBy('created_at')
            ->get();

        $contactIds = $contacts->pluck('id')->toArray();
        $alert->update(['contacts_notified' => $contactIds]);

        $liveLink = config('app.url') . "/trip/{$alert->live_link_token}";

        foreach ($contacts as $contact) {
            $this->notifySMSContact($contact, $userId, $liveLink, $booking);
        }

        $booking->update(['sos_triggered' => true]);

        $this->realtimeService->broadcastSOSAlert($bookingId, $userId, [
            'alert_id' => $alert->id,
            'status' => 'active',
            'live_link' => $liveLink,
        ]);

        $this->notificationService->sendToTopic('admin_safety', '🚨 SOS Alert', "Emergency triggered for booking #{$booking->booking_number}", [
            'type' => 'sos',
            'booking_id' => $bookingId,
            'alert_id' => $alert->id,
        ]);

        return $alert;
    }

    public function deactivateSOS(string $bookingId): void
    {
        $alert = SOSAlert::where('booking_id', $bookingId)
            ->where('status', 'active')
            ->latest('triggered_at')
            ->first();

        if (!$alert) {
            return;
        }

        $alert->update([
            'status' => 'resolved',
            'resolved_at' => now(),
        ]);

        Booking::where('id', $bookingId)->update(['sos_triggered' => false]);

        $this->realtimeService->broadcastSOSAlert($bookingId, $alert->customer_id, [
            'alert_id' => $alert->id,
        ]);
    }

    public function getActiveSOS(): \Illuminate\Database\Eloquent\Collection
    {
        return SOSAlert::where('status', 'active')
            ->with(['booking', 'customer', 'runner'])
            ->orderByDesc('triggered_at')
            ->get();
    }

    private function notifySMSContact(TrustedContact $contact, string $userId, string $liveLink, Booking $booking): void
    {
        Log::info('SOS SMS notification', [
            'contact_name' => $contact->name,
            'contact_phone' => $contact->phone,
            'live_link' => $liveLink,
            'booking_id' => $booking->id,
        ]);
    }
}
