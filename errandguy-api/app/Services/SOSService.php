<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\SOSAlert;
use App\Models\TrustedContact;
use Illuminate\Support\Str;

class SOSService
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    /**
     * Trigger an SOS alert for a booking.
     *
     * @param  string  $bookingId
     * @param  string  $triggeredBy  user-id of the person pulling the alarm
     * @param  string  $role         'customer' or 'runner'
     */
    public function triggerSOS(string $bookingId, string $triggeredBy, string $role = 'customer'): SOSAlert
    {
        $booking = Booking::with(['runner.runnerProfile'])->findOrFail($bookingId);

        $runnerProfile = $booking->runner?->runnerProfile;

        // Idempotency — if there's already an active alert for this booking,
        // return it instead of stacking duplicates.
        $existing = SOSAlert::where('booking_id', $bookingId)
            ->where('status', 'active')
            ->latest('triggered_at')
            ->first();
        if ($existing) {
            return $existing;
        }

        $alert = SOSAlert::create([
            'booking_id' => $bookingId,
            'customer_id' => $booking->customer_id,
            'runner_id' => $booking->runner_id,
            'triggered_by' => $triggeredBy,
            'triggered_by_role' => $role,
            'triggered_at' => now(),
            'customer_lat' => $booking->dropoff_lat,
            'customer_lng' => $booking->dropoff_lng,
            'runner_lat' => $runnerProfile?->current_lat,
            'runner_lng' => $runnerProfile?->current_lng,
            'live_link_token' => Str::random(64),
            'live_link_expires_at' => now()->addMinutes(60),
            'status' => 'active',
        ]);

        // Record WHICH trusted contacts will be notified — part of the durable
        // safety record, so it stays synchronous.
        $contactIds = TrustedContact::where('user_id', $triggeredBy)
            ->orderBy('created_at')
            ->pluck('id')
            ->toArray();
        $alert->update(['contacts_notified' => $contactIds]);

        $booking->update(['sos_triggered' => true]);

        // Everything above is the durable safety write. The OUTBOUND fan-out —
        // trusted-contact SMS, the Reverb realtime broadcast, and the admin
        // FCM topic — is deferred to a job so the panic button returns the alert
        // immediately instead of blocking on the broadcast + Firebase (and, once SMS
        // is wired, one HTTP call per contact). (P7)
        \App\Jobs\NotifySosContactsJob::dispatch($alert->id);

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

        // Tell the runner the emergency was resolved, live over their
        // `notifications.{userId}` Reverb channel (replaces the old realtime
        // table insert). Broadcast-only — no device push.
        $runnerId = Booking::where('id', $bookingId)->value('runner_id');
        if ($runnerId) {
            $this->notificationService->notifyInApp(
                $runnerId,
                'SOS Resolved',
                'The emergency alert has been resolved.',
                [
                    'type' => 'sos',
                    'booking_id' => $bookingId,
                    'alert_id' => $alert->id,
                    'status' => 'resolved',
                ],
            );
        }
    }

    public function getActiveSOS(): \Illuminate\Database\Eloquent\Collection
    {
        return SOSAlert::where('status', 'active')
            ->with(['booking', 'customer', 'runner'])
            ->orderByDesc('triggered_at')
            ->get();
    }
}
