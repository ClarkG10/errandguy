<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use SensitiveParameter;

/**
 * A link for a staff member to choose their admin-panel password: the welcome
 * email when a super admin adds them ($isInvite), or the "Forgot password?"
 * email from the sign-in page (bound in place of Filament's own reset email by
 * AdminPanelProvider, which sets $url).
 *
 * Sent straight away rather than queued, so getting into the panel never
 * depends on the queue worker running.
 */
class StaffPasswordLink extends Notification
{
    public string $url = '';

    public function __construct(
        #[SensitiveParameter]
        public string $token,
        public bool $isInvite = false,
    ) {}

    /** @return array<int, string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $minutes = (int) config('auth.passwords.admins.expire', 60);

        if ($this->isInvite) {
            return (new MailMessage)
                ->subject('You’ve been added to ErrandGuy Admin')
                ->line('A super admin added you to the ErrandGuy staff panel. Choose your password to get started.')
                ->action('Set your password', $this->url)
                ->line("The link works for {$minutes} minutes. If it runs out, ask a super admin to send a new one.")
                ->line('The first time you sign in, you’ll also set up two-step sign-in with an authenticator app or emailed codes.');
        }

        return (new MailMessage)
            ->subject('ErrandGuy Admin - Reset your password')
            ->line('Someone asked to reset the password for your ErrandGuy staff account.')
            ->action('Choose a new password', $this->url)
            ->line("The link works for {$minutes} minutes. If you didn’t ask for this, ignore this email — your password stays the same.");
    }
}
