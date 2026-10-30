<?php

namespace App\Http\Middleware;

use App\Models\AdminUser;
use Closure;
use Filament\Facades\Filament;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * For the staff files and feeds served outside the panel (KYC documents,
 * booking media, the SOS alarm feed): refuse a staff session that is disabled
 * or hasn't set up two-step sign-in yet. Inside the panel, Filament and
 * AuthenticateStaff handle both; without this the same session could
 * still open these URLs directly. Requests without a staff session (an app
 * user's bearer token on booking media) pass through untouched.
 */
class RestrictStaffSessions
{
    public function handle(Request $request, Closure $next): Response
    {
        $staff = Auth::guard('admin')->user();

        if ($staff instanceof AdminUser) {
            abort_unless($staff->canAccessPanel(Filament::getPanel('admin')), 403, 'This staff account is disabled.');
            abort_unless($staff->hasTwoStepSignIn(), 403, 'Set up two-step sign-in in the admin panel first.');
        }

        return $next($request);
    }
}
