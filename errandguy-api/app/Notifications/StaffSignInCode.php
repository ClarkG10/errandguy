<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use SensitiveParameter;

/**
 * The emailed code for a staff member's two-step sign-in to the admin panel
 * (Filament's email code method, see AdminPanelProvider).
 *
 * Sent straight away rather than queued: the code expires in a few minutes,
 * and signing in to the panel must not depend on the queue worker running.
 */
class StaffSignInCode extends Notification
{
    public function __construct(
        #[SensitiveParameter]
        public string $code,
        public int $codeExpiryMinutes,
    ) {}

    /** @return array<int, string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('ErrandGuy Admin - Your sign-in code')
            ->line("Your sign-in code is {$this->code}.")
            ->line("It works for {$this->codeExpiryMinutes} minutes. If you didn’t just try to sign in to ErrandGuy Admin, change your password and tell a super admin.");
    }
}
