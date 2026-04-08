<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class LoginController extends Controller
{
    public function login(LoginRequest $request): JsonResponse
    {
        $request->ensureIsNotRateLimited();

        $user = User::when($request->phone, fn ($q) => $q->where('phone', $request->phone))
            ->when($request->email, fn ($q) => $q->where('email', $request->email))
            ->first();

        if (!$user || !Hash::check($request->password, $user->password_hash)) {
            $request->incrementAttempts();

            throw ValidationException::withMessages([
                'credentials' => ['The provided credentials are incorrect.'],
            ]);
        }

        if ($user->status !== 'active') {
            throw ValidationException::withMessages([
                'status' => ["Your account is {$user->status}. Please contact support."],
            ]);
        }

        $request->clearAttempts();

        $deviceName = $request->input('device_name', $request->header('User-Agent', 'mobile'));

        // Revoke existing tokens for this device
        $user->tokens()->where('name', $deviceName)->delete();

        $token = $user->createToken($deviceName)->plainTextToken;
        $user->update(['last_active_at' => now()]);

        return response()->json([
            'user' => new UserResource($user->load('runnerProfile')),
            'token' => $token,
        ]);
    }
}
