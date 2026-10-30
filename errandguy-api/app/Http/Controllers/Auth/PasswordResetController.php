<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ForgotPasswordRequest;
use App\Http\Requests\Auth\ResetPasswordRequest;
use App\Mail\OneTimeCode;
use App\Models\User;
use App\Services\OTPService;
use App\Support\DeviceSessions;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Password reset with a 6-digit emailed code (OTPService, purpose
 * password_reset): the code is typed into the app, never a link.
 *
 * Brute force is bounded three ways: 5 guesses per code (then it is dropped),
 * 3 codes an hour per address (route throttle 'otp-password-reset'), and 5
 * reset attempts per address and IP every 15 minutes ('auth-verify').
 */
class PasswordResetController extends Controller
{
    public function __construct(
        private OTPService $otp,
    ) {}

    /**
     * POST /auth/forgot-password {email}
     *
     * Always the same answer, whether or not an account uses the address, and
     * the email goes out after the response is sent — so neither the reply
     * nor its timing says which addresses are registered.
     */
    public function forgotPassword(ForgotPasswordRequest $request): JsonResponse
    {
        $email = (string) $request->validated('email');

        if (User::where('email', $email)->exists()) {
            $identifier = OTPService::emailIdentifier($email);
            $code = $this->otp->generateOTP();
            $this->otp->storeOTP($identifier, $code, OTPService::PASSWORD_RESET);

            defer(function () use ($email, $code, $identifier) {
                try {
                    Mail::to($email)->send(new OneTimeCode($code, OTPService::PASSWORD_RESET));
                } catch (\Throwable $e) {
                    $this->otp->invalidateOTP($identifier, OTPService::PASSWORD_RESET);
                    // No raw email in logs (CWE-532).
                    Log::error('Password reset code delivery failed', ['error' => $e->getMessage()]);
                }
            });
        }

        return $this->ok(
            null,
            'If an account uses that email, we’ve sent it a 6-digit code. It expires in '.OTPService::TTL_MINUTES.' minutes.',
        );
    }

    /**
     * POST /auth/reset-password {email, code, password, password_confirmation}
     *
     * Sets the new password and signs the account out everywhere: every token
     * is revoked and every push registration dropped, so whoever held the old
     * password keeps nothing.
     */
    public function resetPassword(ResetPasswordRequest $request): JsonResponse
    {
        $email = (string) $request->validated('email');
        $identifier = OTPService::emailIdentifier($email);

        $result = $this->otp->check($identifier, (string) $request->validated('code'), OTPService::PASSWORD_RESET);

        if ($result === OTPService::LOCKED) {
            return $this->fail(ErrorCode::OTP_MAX_ATTEMPTS);
        }
        if ($result === OTPService::EXPIRED) {
            return $this->fail(ErrorCode::OTP_EXPIRED, 'That code has expired or was already used. Request a new one to continue.');
        }
        if ($result !== OTPService::VALID) {
            return $this->fail(
                ErrorCode::OTP_INVALID,
                merge: ['attempts_remaining' => $this->otp->attemptsRemaining($identifier, OTPService::PASSWORD_RESET)],
            );
        }

        $user = User::where('email', $email)->first();
        if (! $user) {
            return $this->fail(ErrorCode::OTP_EXPIRED, 'That code has expired or was already used. Request a new one to continue.');
        }

        $user->update([
            'password_hash' => Hash::make($request->validated('password'), ['rounds' => 12]),
            // The code reached this inbox, so the address is confirmed.
            'email_verified' => true,
        ]);

        DeviceSessions::signOutEverywhere($user);

        Log::info('Password reset', ['user_id' => $user->id, 'ip' => $request->ip()]);

        return $this->ok(null, 'Your password has been reset. Sign in with your new password.');
    }
}
