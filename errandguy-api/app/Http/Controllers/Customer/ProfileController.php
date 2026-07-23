<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Requests\UploadAvatarRequest;
use App\Http\Resources\UserResource;
use App\Models\RunnerProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'data' => new UserResource($request->user()->load('runnerProfile.documents')),
        ]);
    }

    public function update(UpdateProfileRequest $request): JsonResponse
    {
        $user = $request->user();
        $user->update($request->validated());

        // Auto-create runner profile when role is changed to runner
        if ($request->validated('role') === 'runner' && !$user->runnerProfile) {
            RunnerProfile::create([
                'user_id' => $user->id,
                'verification_status' => 'pending',
            ]);
        }

        return response()->json([
            'data' => new UserResource($user->fresh()->load('runnerProfile.documents')),
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
            'platform' => ['sometimes', 'nullable', 'string', 'max:15'],
        ]);

        $user = $request->user();
        $token = $request->input('fcm_token');

        // Keep the legacy single column populated for backward compatibility.
        $user->update(['fcm_token' => $token]);

        // Register this specific device so a multi-device user keeps receiving
        // pushes on every device (the single column used to be overwritten,
        // silencing all but the most recent). Keyed by token, so the same
        // device re-registering — even after a re-login under a new account —
        // just re-points the row instead of duplicating it.
        \App\Models\DeviceToken::updateOrCreate(
            ['token' => $token],
            [
                'user_id' => $user->id,
                'platform' => $request->input('platform'),
                'last_used_at' => now(),
            ],
        );

        return response()->json([
            'message' => 'FCM token updated successfully.',
        ]);
    }

    public function deleteAccount(Request $request): JsonResponse
    {
        $user = $request->user();

        // Block deletion while there's an in-flight booking on either side
        // (customer or runner). Letting an account vanish mid-errand
        // strands the counterparty and orphans the GPS / chat / payout.
        $hasActive = \App\Models\Booking::where(function ($q) use ($user) {
                $q->where('customer_id', $user->id)
                  ->orWhere('runner_id', $user->id);
            })
            ->whereNotIn('status', ['completed', 'cancelled', 'no_runner'])
            ->exists();

        if ($hasActive) {
            return response()->json([
                'message' => 'You have an active errand in progress. Please complete or cancel it before deleting your account.',
            ], 422);
        }

        // Block deletion if runner has an unpaid wallet balance > 0 — they
        // need to request a payout first or the funds become unrecoverable.
        if ((float) $user->wallet_balance > 0) {
            return response()->json([
                'message' => 'Your wallet balance is ₱'.number_format((float) $user->wallet_balance, 2).'. Please withdraw it before deleting your account.',
            ], 422);
        }

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

        // Drop every registered push device (the FK cascade only fires on a
        // HARD delete, and this is a soft delete) so a deleted account stops
        // receiving pushes.
        $user->deviceTokens()->delete();

        // Soft delete
        $user->delete();

        return response()->json([
            'message' => 'Account deleted successfully.',
        ]);
    }
}
