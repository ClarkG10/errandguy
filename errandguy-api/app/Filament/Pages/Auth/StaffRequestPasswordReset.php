<?php

namespace App\Filament\Pages\Auth;

use Filament\Auth\Pages\PasswordReset\RequestPasswordReset;
use Filament\Notifications\Notification;

/**
 * The staff "Forgot password?" page: Filament's own, but it answers the same
 * way whether or not the email belongs to a staff account. The stock page said
 * "We can't find a user with that email address" for a wrong one (and a
 * different message when that account's link was throttled), which told
 * anyone which addresses are staff — and five wrong passwords on each then
 * locks those accounts out.
 */
class StaffRequestPasswordReset extends RequestPasswordReset
{
    public function request(): void
    {
        parent::request();

        // The stock page cleared the email field only when a link was sent,
        // so the page itself still told a staff address from any other.
        $this->form->fill();
    }

    protected function getFailureNotification(string $status): ?Notification
    {
        return $this->neutralNotification();
    }

    protected function getSentNotification(string $status): ?Notification
    {
        return $this->neutralNotification();
    }

    private function neutralNotification(): Notification
    {
        return Notification::make()
            ->title('Check your email')
            ->body('If that address belongs to a staff account, a link to set a new password is on its way. It expires in an hour.')
            ->success();
    }
}
