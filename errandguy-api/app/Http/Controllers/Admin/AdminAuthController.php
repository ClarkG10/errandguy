<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AdminUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AdminAuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        $admin = AdminUser::where('email', $request->email)->first();

        if (!$admin || !Hash::check($request->password, $admin->password_hash)) {
            throw ValidationException::withMessages([
                'email' => ['Invalid credentials.'],
            ]);
        }

        if (!$admin->is_active) {
            return response()->json(['message' => 'Account is deactivated'], 403);
        }

        $admin->update(['last_login_at' => now()]);

        $token = $admin->createToken('admin-token', ['admin'])->plainTextToken;

        return response()->json([
            'data' => [
                'user' => $admin->only(['id', 'email', 'full_name', 'role']),
                'token' => $token,
            ],
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out']);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $request->user()->only(['id', 'email', 'full_name', 'role']),
        ]);
    }
}
