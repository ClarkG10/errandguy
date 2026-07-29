<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ForgotPasswordRequest;
use App\Http\Requests\Auth\ResetPasswordRequest;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use App\Models\User;

class PasswordResetController extends Controller
{
    public function forgotPassword(ForgotPasswordRequest $request): JsonResponse
    {
        // Only mint a token + send the email for a REAL account, but always
        // return the same generic 200 below regardless — otherwise the distinct
        // registered/unregistered responses leak which emails have accounts.
        if (User::where('email', $request->email)->exists()) {
            $token = Str::random(64);

            DB::table('password_reset_tokens')->updateOrInsert(
                ['email' => $request->email],
                [
                    'token' => Hash::make($token),
                    'created_at' => now(),
                ]
            );

            try {
                Mail::raw(
                    "Your ErrandGuy password reset code is: {$token}\n\nThis code expires in 1 hour.",
                    function ($message) use ($request) {
                        $message->to($request->email)
                            ->subject('ErrandGuy - Password Reset');
                    }
                );
            } catch (\Throwable $e) {
                Log::error('Failed to send password reset email', [
                    'email' => $request->email,
                    'error' => $e->getMessage(),
                ]);

                // 422, never a 503: Cloudflare masks app-level 5xx and the mobile
                // client discards >=500 messages, so this line would be lost.
                return $this->fail(
                    ErrorCode::PASSWORD_RESET_DELIVERY_FAILED,
                    'Unable to send reset email at this time. Please try again later.',
                );
            }
        }

        // Neutral, identical for known + unknown emails.
        return $this->ok(null, 'If an account exists for that email, a password reset link has been sent.');
    }

    public function resetPassword(ResetPasswordRequest $request): JsonResponse
    {
        $record = DB::table('password_reset_tokens')
            ->where('email', $request->email)
            ->first();

        if (!$record || !Hash::check($request->token, $record->token)) {
            return $this->fail(ErrorCode::VALIDATION_FAILED, 'Invalid or expired reset token. Request a new one to continue.');
        }

        // Carbon 3 makes diffInMinutes() SIGNED: now()->diffInMinutes($past)
        // returns a NEGATIVE number, so `> 60` was never true and reset tokens
        // never expired. Compare against an absolute one-hour deadline instead.
        if (\Illuminate\Support\Carbon::parse($record->created_at)->addHour()->isPast()) {
            DB::table('password_reset_tokens')->where('email', $request->email)->delete();

            return $this->fail(ErrorCode::VALIDATION_FAILED, 'Reset token has expired. Please request a new one.');
        }

        $user = User::where('email', $request->email)->firstOrFail();
        $user->update([
            'password_hash' => Hash::make($request->password, ['rounds' => 12]),
        ]);

        // Revoke all tokens
        $user->tokens()->delete();

        DB::table('password_reset_tokens')->where('email', $request->email)->delete();

        return $this->ok(null, 'Password has been reset successfully.');
    }
}
