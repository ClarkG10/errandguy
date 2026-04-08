<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Requests\UploadAvatarRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'data' => new UserResource($request->user()->load('runnerProfile')),
        ]);
    }

    public function update(UpdateProfileRequest $request): JsonResponse
    {
        $user = $request->user();
        $user->update($request->validated());

        return response()->json([
            'data' => new UserResource($user->fresh()->load('runnerProfile')),
            'message' => 'Profile updated successfully.',
        ]);
    }

    public function uploadAvatar(UploadAvatarRequest $request): JsonResponse
    {
        $user = $request->user();
        $file = $request->file('avatar');

        // Delete old avatar if it exists in storage
        if ($user->avatar_url) {
            $oldPath = parse_url($user->avatar_url, PHP_URL_PATH);
            if ($oldPath) {
                Storage::disk('public')->delete(ltrim($oldPath, '/'));
            }
        }

        // Store new avatar with unique name — use guessExtension() for MIME-based extension
        $filename = 'avatars/' . $user->id . '_' . Str::random(8) . '.' . ($file->guessExtension() ?? 'jpg');
        $path = $file->storeAs('', $filename, 'public');

        $user->update([
            'avatar_url' => Storage::disk('public')->url($path),
        ]);

        return response()->json([
            'data' => new UserResource($user->fresh()),
            'message' => 'Avatar uploaded successfully.',
        ]);
    }

    public function updateFCMToken(Request $request): JsonResponse
    {
        $request->validate([
            'fcm_token' => ['required', 'string'],
        ]);

        $request->user()->update([
            'fcm_token' => $request->input('fcm_token'),
        ]);

        return response()->json([
            'message' => 'FCM token updated successfully.',
        ]);
    }

    public function deleteAccount(Request $request): JsonResponse
    {
        $user = $request->user();

        // Anonymize PII
        $user->update([
            'full_name' => 'Deleted User',
            'email' => null,
            'phone' => null,
            'avatar_url' => null,
            'fcm_token' => null,
            'default_lat' => null,
            'default_lng' => null,
        ]);

        // Revoke all tokens
        $user->tokens()->delete();

        // Soft delete
        $user->delete();

        return response()->json([
            'message' => 'Account deleted successfully.',
        ]);
    }
}
