<?php

namespace App\Filament\Pages\Auth;

use App\Models\AdminUser;
use App\Support\StaffSignIn;
use DanHarrin\LivewireRateLimiting\Exceptions\TooManyRequestsException;
use Filament\Auth\Http\Responses\Contracts\LoginResponse;
use Filament\Auth\Pages\Login;
use Filament\Facades\Filament;
use Filament\Notifications\Notification;
use Filament\Schemas\Components\Component;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Guard;
use Illuminate\Contracts\Support\Htmlable;
use Illuminate\Validation\ValidationException;
use SensitiveParameter;

/**
 * The admin panel sign-in page: Filament's own (password, then the two-step
 * code, with its per-IP limit of 5 tries a minute) plus
 *
 *   - a per-account lock: 5 failed attempts on one email address lock it for
 *     15 minutes, whatever IPs they come from (StaffSignIn);
 *   - an audit-log entry for every sign-in and every failed attempt;
 *   - disabled staff refused before a two-step code is ever sent to them.
 */
class StaffLogin extends Login
{
    /** Set when this attempt's failure has been recorded, so it counts once. */
    private bool $failureRecorded = false;

    // One heading per step. A welcome block used to sit under Filament's own
    // "Sign in", and stayed on the two-step code screen too, where it read
    // "Verify your identity … Welcome back, sign in".
    public function getHeading(): string|Htmlable|null
    {
        return filled($this->userUndertakingMultiFactorAuthentication)
            ? parent::getHeading()
            : 'Welcome back';
    }

    public function getSubheading(): string|Htmlable|null
    {
        return filled($this->userUndertakingMultiFactorAuthentication)
            ? parent::getSubheading()
            : 'Sign in to the ErrandGuy operations console — bookings, runners, payments & safety.';
    }

    public function authenticate(): ?LoginResponse
    {
        $this->failureRecorded = false;

        $typed = is_string($this->data['email'] ?? null) ? trim($this->data['email']) : '';
        $email = StaffSignIn::normalizeEmail($typed);
        $staff = $typed !== '' ? AdminUser::where('email', $typed)->first() : null;

        $lockedFor = StaffSignIn::lockedSeconds($email);
        if ($lockedFor > 0) {
            StaffSignIn::recordLockedAttempt($email, $staff);

            Notification::make()
                ->title('Too many failed sign-ins')
                ->body('This account is locked for '.max(1, (int) ceil($lockedFor / 60)).' more minute(s). Try again later, or ask a super admin.')
                ->danger()
                ->send();

            return null;
        }

        if ($staff && ! $staff->canAccessPanel(Filament::getCurrentOrDefaultPanel())) {
            try {
                $this->rateLimit(5);
            } catch (TooManyRequestsException $exception) {
                $this->getRateLimitedNotification($exception)?->send();

                return null;
            }

            $this->failureRecorded = true;
            StaffSignIn::recordFailure($email, $staff, 'account disabled');
            $this->throwFailureValidationException();
        }

        $wasAskingForCode = filled($this->userUndertakingMultiFactorAuthentication);

        try {
            $response = parent::authenticate();
        } catch (ValidationException $e) {
            // The password was right but the two-step code was wrong or expired.
            if ($wasAskingForCode && ! $this->failureRecorded) {
                StaffSignIn::recordFailure($email, $staff, 'wrong two-step code');
            }

            throw $e;
        }

        $signedIn = Filament::auth()->user();
        if ($response !== null && $signedIn instanceof AdminUser) {
            StaffSignIn::recordSuccess($signedIn);
        }

        return $response;
    }

    /**
     * @param  array<string, mixed>  $credentials
     */
    protected function fireFailedEvent(Guard $guard, ?Authenticatable $user, #[SensitiveParameter] array $credentials): void
    {
        parent::fireFailedEvent($guard, $user, $credentials);

        $this->failureRecorded = true;

        StaffSignIn::recordFailure(
            StaffSignIn::normalizeEmail($credentials['email'] ?? null),
            $user instanceof AdminUser ? $user : null,
            match (true) {
                ! $user instanceof AdminUser => 'no staff account with this email',
                ! $user->canAccessPanel(Filament::getCurrentOrDefaultPanel()) => 'account disabled',
                default => 'wrong password',
            },
        );
    }

    protected function getRememberFormComponent(): Component
    {
        return parent::getRememberFormComponent()->label('Keep me signed in for 14 days');
    }
}
