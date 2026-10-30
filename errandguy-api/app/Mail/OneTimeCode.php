<?php

namespace App\Mail;

use App\Services\OTPService;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * A 6-digit one-time code by email: signing in, resetting a password or
 * confirming an email address. Plain text on purpose — the code is the whole
 * message, and there is never a link to click.
 */
class OneTimeCode extends Mailable
{
    public function __construct(
        public string $code,
        public string $purpose = OTPService::SIGN_IN,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: match ($this->purpose) {
                OTPService::PASSWORD_RESET => 'ErrandGuy - Your password reset code',
                OTPService::EMAIL_VERIFICATION => 'ErrandGuy - Confirm your email address',
                default => 'ErrandGuy - Verification Code',
            },
        );
    }

    public function content(): Content
    {
        return new Content(
            text: 'emails.one-time-code',
            with: [
                'code' => $this->code,
                'purpose' => $this->purpose,
                'minutes' => OTPService::TTL_MINUTES,
            ],
        );
    }
}
