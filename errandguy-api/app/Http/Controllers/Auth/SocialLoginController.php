<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\SocialLoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SocialLoginController extends Controller
{
    public function login(SocialLoginRequest $request): JsonResponse
    {
        $socialUser = match ($request->provider) {
            'google' => $this->verifyGoogleToken($request->token),
            'facebook' => $this->verifyFacebookToken($request->token),
        };

        if (!$socialUser || !isset($socialUser['email'])) {
            throw ValidationException::withMessages([
                'token' => ['Unable to verify social login. Please try again.'],
            ]);
        }

        $user = User::where('email', $socialUser['email'])->first();

        if (!$user) {
            $user = User::create([
                'email' => $socialUser['email'],
                'full_name' => $socialUser['name'] ?? '',
                'avatar_url' => $socialUser['avatar'] ?? null,
                'password_hash' => Hash::make(Str::random(32)),
                'email_verified' => true,
                'status' => 'active',
                'role' => 'customer',
            ]);
        }

        if ($user->status !== 'active') {
            throw ValidationException::withMessages([
                'status' => ["Your account is {$user->status}. Please contact support."],
            ]);
        }

        $token = $user->createToken($request->header('User-Agent', 'mobile'))->plainTextToken;
        $user->update(['last_active_at' => now()]);

        return response()->json([
            'user' => new UserResource($user->load('runnerProfile')),
            'token' => $token,
        ]);
    }

    protected function verifyGoogleToken(string $token): ?array
    {
        $response = Http::get('https://oauth2.googleapis.com/tokeninfo', [
            'id_token' => $token,
        ]);

        if ($response->failed()) {
            return null;
        }

        $data = $response->json();

        return [
            'email' => $data['email'] ?? null,
            'name' => $data['name'] ?? null,
            'avatar' => $data['picture'] ?? null,
        ];
    }

    protected function verifyFacebookToken(string $token): ?array
    {
        $response = Http::get('https://graph.facebook.com/me', [
            'fields' => 'id,name,email,picture.type(large)',
            'access_token' => $token,
        ]);

        if ($response->failed()) {
            return null;
        }

        $data = $response->json();

        return [
            'email' => $data['email'] ?? null,
            'name' => $data['name'] ?? null,
            'avatar' => $data['picture']['data']['url'] ?? null,
        ];
    }
}
