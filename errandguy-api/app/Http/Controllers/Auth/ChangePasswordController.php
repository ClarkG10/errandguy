<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Support\DeviceSessions;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

class ChangePasswordController extends Controller
{
    /**
     * PUT /user/password {current_password, password, password_confirmation,
     * device_token?}
     *
     * Keeps this phone signed in and signs every other device out: their
     * tokens are revoked and their push registrations dropped, so a phone that
     * was signed out stops receiving this account's notifications. This
     * phone's registration is kept when it is linked to the current sign-in
     * (device_id) or its push token is sent as device_token.
     */
    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => [
                'required',
                'string',
                'confirmed',
                'different:current_password',
                Password::min(8)->mixedCase()->numbers()->symbols(),
            ],
            'device_token' => ['sometimes', 'nullable', 'string', 'max:255'],
        ], [
            'password.different' => 'Choose a new password that is different from your current one.',
        ]);

        $user = $request->user();

        if (! Hash::check($validated['current_password'], $user->password_hash)) {
            return $this->fail(
                ErrorCode::VALIDATION_FAILED,
                'Your current password is incorrect.',
                errors: ['current_password' => ['Your current password is incorrect.']],
            );
        }

        $user->update(['password_hash' => Hash::make($validated['password'], ['rounds' => 12])]);

        $current = DeviceSessions::currentToken($request);
        $user->tokens()
            ->when($current, fn ($q) => $q->whereKeyNot($current->getKey()))
            ->delete();

        DeviceSessions::forgetAllDevices(
            $user,
            keepDeviceId: DeviceSessions::deviceIdOf($current),
            keepPushToken: $validated['device_token'] ?? null,
        );

        return $this->ok(null, 'Password changed. You’ve been signed out on your other devices.');
    }
}
