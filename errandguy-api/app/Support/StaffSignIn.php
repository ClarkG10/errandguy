<?php

namespace App\Support;

use App\Models\AdminUser;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Staff sign-in bookkeeping for the admin panel (StaffLogin):
 *
 *   - every sign-in and every failed attempt goes to the `admin` audit log
 *     with who, when and from which IP;
 *   - 5 failed attempts on one email address lock it for 15 minutes. This is
 *     on top of the per-IP limit on the sign-in form, so spreading guesses
 *     over many IPs doesn't help. It counts by the address typed, whether or
 *     not a staff account has it, so the lock never reveals which addresses
 *     are real.
 */
final class StaffSignIn
{
    public const MAX_FAILURES = 5;

    public const LOCK_MINUTES = 15;

    public static function normalizeEmail(mixed $email): string
    {
        return is_string($email) ? Str::lower(trim($email)) : '';
    }

    /** Seconds until this address may try again, or 0 when it isn't locked. */
    public static function lockedSeconds(string $email): int
    {
        if ($email === '') {
            return 0;
        }

        $until = (int) Cache::get(self::lockKey($email), 0);

        return max(0, $until - now()->getTimestamp());
    }

    /** A failed attempt: logged, counted, and the address locked on the 5th. */
    public static function recordFailure(string $email, ?AdminUser $staff, string $reason): void
    {
        self::log('auth.sign_in_failed', $staff, null, [
            'email' => Str::limit($email, 191, ''),
            'reason' => $reason,
        ], 'Failed staff sign-in: '.$reason);

        if ($email === '') {
            return;
        }

        $failures = RateLimiter::hit(self::failuresKey($email), self::LOCK_MINUTES * 60);

        if ($failures >= self::MAX_FAILURES) {
            Cache::put(
                self::lockKey($email),
                now()->addMinutes(self::LOCK_MINUTES)->getTimestamp(),
                self::LOCK_MINUTES * 60,
            );
            RateLimiter::clear(self::failuresKey($email));

            self::log('auth.sign_in_locked', $staff, null, [
                'email' => Str::limit($email, 191, ''),
                'minutes' => self::LOCK_MINUTES,
            ], 'Staff sign-in locked after '.self::MAX_FAILURES.' failed attempts');
        }
    }

    /** A refused attempt while the address is locked (not counted again). */
    public static function recordLockedAttempt(string $email, ?AdminUser $staff): void
    {
        self::log('auth.sign_in_failed', $staff, null, [
            'email' => Str::limit($email, 191, ''),
            'reason' => 'locked after too many failed attempts',
        ], 'Failed staff sign-in: locked');
    }

    public static function recordSuccess(AdminUser $staff): void
    {
        RateLimiter::clear(self::failuresKey(self::normalizeEmail($staff->email)));

        $staff->forceFill(['last_login_at' => now()])->save();

        self::log('auth.signed_in', $staff, $staff, [
            'two_step' => $staff->twoStepMethod() ?? 'not set up yet',
        ], 'Staff signed in');
    }

    /** Lift a lock early (a super admin vouching for the staff member). */
    public static function unlock(string $email): void
    {
        $email = self::normalizeEmail($email);
        Cache::forget(self::lockKey($email));
        RateLimiter::clear(self::failuresKey($email));
    }

    private static function log(string $event, ?AdminUser $subject, ?AdminUser $causer, array $properties, string $description): void
    {
        $logger = activity('admin')
            ->event($event)
            ->withProperties([
                ...$properties,
                'ip' => request()->ip(),
                'user_agent' => Str::limit((string) request()->userAgent(), 255, ''),
            ]);

        if ($subject) {
            $logger->performedOn($subject);
        }
        if ($causer) {
            $logger->causedBy($causer);
        }

        $logger->log($description);
    }

    private static function failuresKey(string $email): string
    {
        return 'staff-sign-in-failures:'.sha1($email);
    }

    private static function lockKey(string $email): string
    {
        return 'staff-sign-in-lock:'.sha1($email);
    }
}
