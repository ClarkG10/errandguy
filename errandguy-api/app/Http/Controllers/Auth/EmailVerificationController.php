<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Mail\OneTimeCode;
use App\Services\OTPService;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * "Verify later": a signed-in user confirms the email on their account with a
 * 6-digit code, any time after sign-up. Changing the email on the profile
 * clears email_verified again (ProfileController::update).
 */
class EmailVerificationController extends Controller
{
    public function __construct(
        private OTPService $otp,
    ) {}

    /** POST /user/email/send-code — email a code to the account's current address. */
    public function send(Request $request): JsonResponse
    {
        $user = $request->user();

        if (blank($user->email)) {
            return $this->fail(
                ErrorCode::VALIDATION_FAILED,
                'Add an email address to your profile first.',
                errors: ['email' => ['Add an email address to your profile first.']],
            );
        }

        if ($user->email_verified) {
            return $this->ok(['email_verified' => true], 'Your email address is already confirmed.');
        }

        $identifier = OTPService::emailIdentifier($user->email);
        $code = $this->otp->generateOTP();
        $this->otp->storeOTP($identifier, $code, OTPService::EMAIL_VERIFICATION);

        try {
            Mail::to($user->email)->send(new OneTimeCode($code, OTPService::EMAIL_VERIFICATION));
        } catch (\Throwable $e) {
            $this->otp->invalidateOTP($identifier, OTPService::EMAIL_VERIFICATION);
            Log::error('Email verification code delivery failed', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return $this->fail(ErrorCode::OTP_DELIVERY_FAILED);
        }

        return $this->ok(
            ['email_verified' => false],
            'We sent a 6-digit code to your email. It expires in '.OTPService::TTL_MINUTES.' minutes.',
        );
    }

    /** POST /user/email/verify {code} — confirm the account's current address. */
    public function verify(Request $request): JsonResponse
    {
        $request->validate(['code' => ['required', 'string', 'digits:6']]);

        $user = $request->user();

        if (blank($user->email)) {
            return $this->fail(ErrorCode::VALIDATION_FAILED, 'Add an email address to your profile first.');
        }

        if (! $user->email_verified) {
            $identifier = OTPService::emailIdentifier($user->email);
            $result = $this->otp->check($identifier, (string) $request->input('code'), OTPService::EMAIL_VERIFICATION);

            if ($result !== OTPService::VALID) {
                return $this->otpFailure($result, $identifier);
            }

            $user->update(['email_verified' => true]);
        }

        return $this->ok(
            new UserResource($user->fresh()->load('runnerProfile')),
            'Your email address is confirmed.',
        );
    }

    private function otpFailure(string $result, string $identifier): JsonResponse
    {
        return match ($result) {
            OTPService::LOCKED => $this->fail(ErrorCode::OTP_MAX_ATTEMPTS),
            OTPService::EXPIRED => $this->fail(ErrorCode::OTP_EXPIRED),
            default => $this->fail(
                ErrorCode::OTP_INVALID,
                merge: ['attempts_remaining' => $this->otp->attemptsRemaining($identifier, OTPService::EMAIL_VERIFICATION)],
            ),
        };
    }
}
