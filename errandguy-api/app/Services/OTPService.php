<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

class OTPService
{
    public function generateOTP(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    public function storeOTP(string $identifier, string $otp): void
    {
        $hashed = Hash::make($otp);
        Cache::put("otp:{$identifier}", $hashed, now()->addMinutes(5));
        Cache::forget("otp_attempts:{$identifier}");
    }

    public function verifyOTP(string $identifier, string $code): bool
    {
        $hashedOTP = Cache::get("otp:{$identifier}");

        if (!$hashedOTP) {
            return false;
        }

        $attempts = $this->getAttemptCount($identifier);

        if ($attempts >= 5) {
            $this->invalidateOTP($identifier);
            return false;
        }

        if (!Hash::check($code, $hashedOTP)) {
            $this->incrementAttempts($identifier);
            return false;
        }

        $this->invalidateOTP($identifier);
        return true;
    }

    public function invalidateOTP(string $identifier): void
    {
        Cache::forget("otp:{$identifier}");
        Cache::forget("otp_attempts:{$identifier}");
    }

    public function getAttemptCount(string $identifier): int
    {
        return (int) Cache::get("otp_attempts:{$identifier}", 0);
    }

    public function incrementAttempts(string $identifier): void
    {
        $attempts = $this->getAttemptCount($identifier) + 1;
        Cache::put("otp_attempts:{$identifier}", $attempts, now()->addMinutes(5));
    }

    public function sendViaSMS(string $phone, string $otp): void
    {
        // TODO: Integrate with Semaphore or Twilio
        // For development: log the OTP
        logger()->info("OTP for {$phone}: {$otp}");
    }

    public function sendViaEmail(string $email, string $otp): void
    {
        Mail::raw("Your ErrandGuy verification code is: {$otp}. It expires in 5 minutes.", function ($message) use ($email) {
            $message->to($email)
                ->subject('ErrandGuy - Verification Code');
        });
    }
}
