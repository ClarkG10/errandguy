<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\RunnerProfile;
use App\Support\DeviceSessions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LogoutController extends Controller
{
    /**
     * POST /auth/logout {device_token?}
     *
     * Ends this sign-in and stops this phone getting the account's pushes: the
     * push registration for `device_token` (the Expo push token) is dropped,
     * or — when the app doesn't send it — the one registered from this
     * sign-in's device_id. A shared or handed-down phone must not keep
     * receiving the previous user's notifications.
     */
    public function logout(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'device_token' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);

        $user = $request->user();
        $token = DeviceSessions::currentToken($request);

        DeviceSessions::forgetDevice(
            $user,
            $validated['device_token'] ?? null,
            DeviceSessions::deviceIdOf($token),
        );

        $token?->delete();

        // A runner who signs out of their last sign-in can't receive an offer,
        // so stop matching them now instead of after the 30-minute idle sweep.
        // Still signed in on another phone: they stay online there.
        if (! $user->tokens()->exists()) {
            RunnerProfile::switchOffline($user->id);
        }

        return response()->json([
            'message' => 'Logged out successfully.',
        ]);
    }

    /**
     * POST /auth/logout-all — "Sign out of all devices": every sign-in and
     * every push registration of this account, this phone's included.
     */
    public function logoutAll(Request $request): JsonResponse
    {
        DeviceSessions::signOutEverywhere($request->user());

        return response()->json([
            'message' => 'Signed out of all devices.',
        ]);
    }
}
