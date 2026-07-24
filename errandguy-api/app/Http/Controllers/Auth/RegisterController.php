<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

class RegisterController extends Controller
{
    public function register(RegisterRequest $request): JsonResponse
    {
        Log::info('Registration attempt', [
            'phone' => $request->phone,
            'email' => $request->email,
            'role' => $request->role,
            'ip' => $request->ip(),
        ]);

        $user = DB::transaction(function () use ($request) {
            $user = User::create([
                'phone' => $request->phone,
                'email' => $request->email,
                'password_hash' => Hash::make($request->password, ['rounds' => 12]),
                'full_name' => $request->full_name,
                'role' => $request->role ?? 'customer',
                'status' => 'active',
            ]);

            if ($request->role === 'runner') {
                RunnerProfile::create([
                    'user_id' => $user->id,
                    'verification_status' => 'pending',
                ]);
            }

            Notification::create([
                'user_id' => $user->id,
                'type' => 'system',
                'title' => 'Welcome to ErrandGuy!',
                'body' => 'Your account has been created successfully. Start exploring!',
            ]);

            return $user;
        });

        Log::info('Registration successful', [
            'user_id' => $user->id,
            'role' => $user->role,
            'ip' => $request->ip(),
        ]);

        $token = $user->createToken($request->header('User-Agent', 'mobile'))->plainTextToken;

        // The account belongs to the caller, so render the self-view (email /
        // verified flags / wallet). The request isn't authenticated yet here,
        // so without this UserResource would strip the owner's own PII.
        request()->setUserResolver(fn () => $user);

        return response()->json([
            'user' => new UserResource($user->load('runnerProfile')),
            'token' => $token,
        ], 201);
    }
}
