<?php

namespace App\Http\Middleware;

use App\Models\AdminUser;
use Filament\Facades\Filament;
use Filament\Http\Middleware\Authenticate;

/**
 * The admin panel's sign-in check (Filament's own), which also signs a staff
 * member out on their next request once a super admin disables them — instead
 * of leaving the session alive behind a 403. Disabling also changes their
 * remember token (StaffAccountService), so a "keep me signed in" cookie stops
 * working too.
 */
class AuthenticateStaff extends Authenticate
{
    protected function authenticate($request, array $guards): void
    {
        $guard = Filament::auth();
        $staff = $guard->user();

        if ($staff instanceof AdminUser && ! $staff->canAccessPanel(Filament::getCurrentOrDefaultPanel())) {
            $guard->logout();

            if ($request->hasSession()) {
                $request->session()->invalidate();
                $request->session()->regenerateToken();
            }

            $this->unauthenticated($request, $guards);
        }

        parent::authenticate($request, $guards);
    }
}
