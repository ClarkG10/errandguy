<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\SendOTPRequest;
use App\Http\Requests\Auth\VerifyOTPRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\OTPService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class OTPController extends Controller
{
    public function __construct(
        protected OTPService $otpService,
    ) {}

    public function sendOTP(SendOTPRequest $request): JsonResponse
    {
        $identifier = $request->phone ?? $request->email;

        Log::info('OTP send requested', [
            'identifier' => $identifier,
            'channel' => $request->phone ? 'sms' : 'email',
            'ip' => $request->ip(),
        ]);

        $otp = $this->otpService->generateOTP();

        $this->otpService->storeOTP($identifier, $otp);

        if ($request->phone) {
            $this->otpService->sendViaSMS($request->phone, $otp);
        } else {
            $this->otpService->sendViaEmail($request->email, $otp);
        }

        return response()->json([
            'message' => 'Verification code sent successfully.',
        ]);
    }

    public function verifyOTP(VerifyOTPRequest $request): JsonResponse
    {
        $identifier = $request->phone ?? $request->email;

        Log::info('OTP verify attempt', [
            'identifier' => $identifier,
            'ip' => $request->ip(),
        ]);

        $attempts = $this->otpService->getAttemptCount($identifier);

        if ($attempts >= 5) {
            $this->otpService->invalidateOTP($identifier);

            return response()->json([
                'message' => 'Too many failed attempts. Please request a new code.',
            ], 422);
        }

        if (!$this->otpService->verifyOTP($identifier, $request->code)) {
            return response()->json([
                'message' => 'Invalid verification code.',
                'attempts_remaining' => max(0, 4 - $attempts),
            ], 422);
        }

        // Mark phone/email as verified on user
        $user = User::when($request->phone, fn ($q) => $q->where('phone', $request->phone))
            ->when($request->email, fn ($q) => $q->where('email', $request->email))
            ->first();

        if ($user) {
            if ($request->phone) {
                $user->update(['phone_verified' => true]);
            } else {
                $user->update(['email_verified' => true]);
            }

            $token = $user->createToken($request->header('User-Agent', 'mobile'))->plainTextToken;

            return response()->json([
                'message' => 'Verification successful.',
                'user' => new UserResource($user->load('runnerProfile')),
                'token' => $token,
            ]);
        }

        return response()->json([
            'message' => 'Verification successful.',
            'verified' => true,
        ]);
    }
}
