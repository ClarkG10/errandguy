<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * The out-of-panel ops alert: "these queues have users waiting on a human".
 *
 * Sent by {@see \App\Console\Commands\AdminQueueAlertCommand} over the mail
 * transport already configured for OTP / password reset (Gmail API) — no new
 * service. Carries display-ready rows only (no models, no Carbon), so it
 * serializes cleanly if it is ever queued.
 */
class AdminQueueDigest extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * @param  array<int, array{key:string,label:string,count:int,oldest_human:string,age_minutes:int,threshold_label:string,note:string}>  $queues
     */
    public function __construct(public array $queues) {}

    public function envelope(): Envelope
    {
        $count = count($this->queues);

        // Lead with the most urgent queue's label so the subject is actionable
        // in a notification preview, not just a count.
        $lead = $this->queues[0]['label'] ?? 'Operational queues';

        return new Envelope(
            subject: sprintf(
                '[%s ops] %s%s need attention',
                config('app.name', 'ErrandGuy'),
                $lead,
                $count > 1 ? ' +'.($count - 1).' more' : '',
            ),
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.admin-queue-digest',
            with: [
                'queues' => $this->queues,
                'panelUrl' => rtrim((string) config('app.url'), '/').'/admin',
                'generatedAt' => now()->toDayDateTimeString(),
            ],
        );
    }
}
