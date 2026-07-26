<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Models\SOSAlert;
use App\Models\TrustedContact;
use App\Services\NotificationService;
use App\Services\RealtimeService;
use Illuminate\Support\Facades\Log;

/**
 * Fan an SOS alert OUT to trusted contacts (SMS), the participants' realtime
 * channel (Supabase PostgREST), and the admin safety topic (FCM) — off the
 * request thread.
 *
 * The durable safety record — the SOSAlert row, the `sos_triggered` flag, and
 * `contacts_notified` — is written synchronously by SOSService::triggerSOS.
 * Only this outbound fan-out is deferred, so the panic button returns as soon
 * as the record is persisted instead of blocking on Supabase + Firebase
 * round-trips (and, once wired, one SMS HTTP call per trusted contact — which
 * would make emergency-alert latency scale linearly with contact count). (P7)
 */
class NotifySosContactsJob extends BaseJob
{
    public function __construct(public string $alertId) {}

    public function handle(NotificationService $notifications, RealtimeService $realtime): void
    {
        $alert = SOSAlert::with('booking')->find($this->alertId);
        if (!$alert || !$alert->booking || $alert->status !== 'active') {
            return;
        }

        $booking = $alert->booking;
        $role = $alert->triggered_by_role;
        $triggeredBy = $alert->triggered_by;
        $liveLink = config('app.url') . "/trip/{$alert->live_link_token}";

        $contacts = TrustedContact::where('user_id', $triggeredBy)
            ->orderBy('created_at')
            ->get();
        foreach ($contacts as $contact) {
            $this->notifySMSContact($contact, $liveLink, $booking);
        }

        $realtime->broadcastSOSAlert($booking->id, $triggeredBy, [
            'alert_id' => $alert->id,
            'status' => 'active',
            'live_link' => $liveLink,
            'triggered_by_role' => $role,
        ]);

        $notifications->sendToTopic(
            'admin_safety',
            '🚨 SOS Alert',
            "Emergency triggered by {$role} for booking #{$booking->booking_number}",
            [
                'type' => 'sos',
                'booking_id' => $booking->id,
                'alert_id' => $alert->id,
                'triggered_by_role' => $role,
            ]
        );
    }

    private function notifySMSContact(TrustedContact $contact, string $liveLink, Booking $booking): void
    {
        // SMS delivery to trusted contacts is not yet wired to a provider. Do
        // NOT log the live-link token or the contact's phone number — the token
        // grants unauthenticated access to the victim's live location, and the
        // phone is PII. Emit only a non-sensitive breadcrumb. See
        // SYSTEM_AUDIT_2026-07.md (C3): this must send a real SMS before SOS can
        // claim "contacts notified".
        Log::warning('SOS trusted-contact SMS not delivered (no SMS provider configured)', [
            'booking_id' => $booking->id,
            'contact_id' => $contact->id,
        ]);
    }
}
