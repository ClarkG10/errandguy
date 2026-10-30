<?php

namespace App\Mail;

use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use App\Models\SOSAlert;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The email staff get the moment someone presses SOS: who, which errand,
 * where they are and when. Sent by NotifySosContactsJob to every address in
 * the ops_alert_emails setting, over the same mailer as OTP and password
 * reset. Built from display-ready strings only.
 */
class SosStaffAlert extends Mailable
{
    /**
     * @param  array<string, string|null>  $facts
     */
    public function __construct(public array $facts) {}

    public static function forAlert(SOSAlert $alert): self
    {
        $alert->loadMissing(['booking.errandType', 'triggeredBy']);
        $person = $alert->triggeredBy;
        $booking = $alert->booking;
        $timezone = config('app.business_timezone', 'Asia/Manila');

        return new self([
            'name' => $person?->full_name ?: 'Unknown',
            'role' => $alert->triggered_by_role === 'runner' ? 'Runner' : 'Customer',
            'phone' => $person?->phone,
            'errand' => $booking
                ? trim(($booking->booking_number ?? $booking->id).' · '.($booking->errandType?->name ?? 'Errand').' · '.str_replace('_', ' ', (string) $booking->status))
                : null,
            'location' => $alert->triggerLocationLabel(),
            'map_url' => $alert->triggerMapUrl(),
            'live_url' => filled($alert->live_link_token)
                ? rtrim((string) config('app.url'), '/').'/trip/'.$alert->live_link_token
                : null,
            'time' => ($alert->triggered_at ?? now())->copy()->timezone($timezone)->format('D, M j Y, g:i A').' ('.$timezone.')',
            'panel_url' => SOSAlertResource::getUrl('view', ['record' => $alert->id], panel: 'admin'),
        ]);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: sprintf(
                '[%s SOS] %s (%s) needs help%s',
                config('app.name', 'ErrandGuy'),
                $this->facts['name'] ?? 'Someone',
                strtolower($this->facts['role'] ?? 'user'),
                filled($this->facts['errand'] ?? null) ? ' — '.strtok((string) $this->facts['errand'], ' ') : '',
            ),
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.sos-staff-alert',
            with: ['facts' => $this->facts],
        );
    }
}
