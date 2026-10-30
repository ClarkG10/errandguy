<?php

namespace App\Services;

use App\Mail\OneTimeCode;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

/**
 * 6-digit one-time codes, kept hashed in the cache for TTL_MINUTES and good
 * for MAX_ATTEMPTS guesses. Each purpose keeps its own code and counter, so a
 * password-reset code can't sign anyone in and vice versa. Sending a new code
 * replaces the old one and resets its counter; how often codes may be sent is
 * capped by the route throttles (3 an hour per recipient).
 */
class OTPService
{
    /** Passwordless sign-in / contact verification (send-otp, verify-otp). */
    public const SIGN_IN = 'sign_in';

    public const PASSWORD_RESET = 'password_reset';

    public const EMAIL_VERIFICATION = 'email_verification';

    public const TTL_MINUTES = 5;

    public const MAX_ATTEMPTS = 5;

    /** Results of {@see check()}. */
    public const VALID = 'valid';

    public const INVALID = 'invalid';

    public const EXPIRED = 'expired';

    public const LOCKED = 'locked';

    /** One spelling of an address per mailbox, so "Ana@x.com" and "ana@x.com" share a code. */
    public static function emailIdentifier(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    public function generateOTP(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    public function storeOTP(string $identifier, string $otp, string $purpose = self::SIGN_IN): void
    {
        Cache::put($this->codeKey($identifier, $purpose), Hash::make($otp), now()->addMinutes(self::TTL_MINUTES));
        Cache::forget($this->attemptsKey($identifier, $purpose));
    }

    /**
     * Check a code: VALID (and used up), INVALID (wrong, guesses left),
     * EXPIRED (no live code: expired, used, or never sent) or LOCKED (out of
     * guesses; the code is dropped).
     *
     * Every guess is counted with an atomic increment BEFORE the hash is
     * compared, so a burst of parallel guesses can't all read "0 tries so far".
     */
    public function check(string $identifier, string $code, string $purpose = self::SIGN_IN): string
    {
        $hashed = Cache::get($this->codeKey($identifier, $purpose));

        if (! $hashed) {
            return self::EXPIRED;
        }

        $attemptsKey = $this->attemptsKey($identifier, $purpose);
        Cache::add($attemptsKey, 0, now()->addMinutes(self::TTL_MINUTES));
        $attempt = (int) Cache::increment($attemptsKey);

        if ($attempt > self::MAX_ATTEMPTS) {
            $this->invalidateOTP($identifier, $purpose);

            return self::LOCKED;
        }

        if (! Hash::check($code, $hashed)) {
            return self::INVALID;
        }

        $this->invalidateOTP($identifier, $purpose);

        return self::VALID;
    }

    public function verifyOTP(string $identifier, string $code, string $purpose = self::SIGN_IN): bool
    {
        return $this->check($identifier, $code, $purpose) === self::VALID;
    }

    public function invalidateOTP(string $identifier, string $purpose = self::SIGN_IN): void
    {
        Cache::forget($this->codeKey($identifier, $purpose));
        Cache::forget($this->attemptsKey($identifier, $purpose));
    }

    public function getAttemptCount(string $identifier, string $purpose = self::SIGN_IN): int
    {
        return (int) Cache::get($this->attemptsKey($identifier, $purpose), 0);
    }

    public function attemptsRemaining(string $identifier, string $purpose = self::SIGN_IN): int
    {
        return max(0, self::MAX_ATTEMPTS - $this->getAttemptCount($identifier, $purpose));
    }

    public function incrementAttempts(string $identifier, string $purpose = self::SIGN_IN): void
    {
        $attemptsKey = $this->attemptsKey($identifier, $purpose);
        Cache::add($attemptsKey, 0, now()->addMinutes(self::TTL_MINUTES));
        Cache::increment($attemptsKey);
    }

    public function sendViaSMS(string $phone, string $otp): void
    {
        // No SMS provider is wired for codes yet. Do NOT log the OTP — it is a
        // one-time auth credential (CWE-532: logging it lets anyone with log
        // access take over the account within the code's lifetime). Fail loudly
        // instead of pretending the code was sent: OTPController catches this,
        // drops the stored OTP and answers a clean 422.
        throw new \RuntimeException('SMS delivery is not configured.');
    }

    public function sendViaEmail(string $email, string $otp, string $purpose = self::SIGN_IN): void
    {
        Mail::to($email)->send(new OneTimeCode($otp, $purpose));
    }

    private function codeKey(string $identifier, string $purpose): string
    {
        // Sign-in codes keep their original key so codes already sent survive a deploy.
        return $purpose === self::SIGN_IN ? "otp:{$identifier}" : "otp:{$purpose}:{$identifier}";
    }

    private function attemptsKey(string $identifier, string $purpose): string
    {
        return $purpose === self::SIGN_IN ? "otp_attempts:{$identifier}" : "otp_attempts:{$purpose}:{$identifier}";
    }
}
