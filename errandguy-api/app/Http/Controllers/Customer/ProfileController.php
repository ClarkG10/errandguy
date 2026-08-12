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

        // A physical device maps to exactly ONE account at a time. Clear this
        // token from any OTHER user's legacy fcm_token column first, so that a
        // shared-device account switch can't leave the previous user still
        // pointing at this device — NotificationService falls back to the
        // legacy column, so a stale value there misdelivers the previous user's
        // notifications (and their PII) to whoever logged in next (RT-1).
        \App\Models\User::where('fcm_token', $token)
            ->where('id', '!=', $user->id)
            ->update(['fcm_token' => null]);

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

        // Block deletion while the wallet balance is non-zero in EITHER
        // direction — anonymizing the account makes the money unrecoverable.
        $balance = (float) $user->wallet_balance;
        if ($balance > 0) {
            // Owed TO the runner — they must withdraw first.
            return response()->json([
                'message' => 'Your wallet balance is ₱'.number_format($balance, 2).'. Please withdraw it before deleting your account.',
            ], 422);
        }
        if ($balance < 0) {
            // A negative balance is a debt owed to the platform — e.g. the
            // service fee on a cash errand, normally netted from future earnings.
            // Deleting would erase the identity and make the debt uncollectable,
            // so require it settled first (a cash runner sits negative until they
            // earn it back). Without this the debt silently escapes on deletion.
            return response()->json([
                'message' => 'You have an outstanding balance of ₱'.number_format(abs($balance), 2).' owed to ErrandGuy. Please settle it before deleting your account.',
            ], 422);
        }

        // ── Right to erasure (PH Data Privacy Act) — PRIV-1 ─────────────────
        // A soft delete leaves child PII intact (the FK cascade only fires on a
        // HARD delete), so erase it explicitly. Financial records (bookings,
        // wallet_transactions, payments) are RETAINED for audit/tax, but the PII
        // embedded in or attached to them is removed/redacted.
        //
        // Collect files to remove AFTER the DB work commits — file deletes are
        // not transactional, so doing them only once the rows are gone avoids
        // orphaning a live account's files should the transaction roll back.
        $filesToDelete = [];
        $kycFilesToDelete = [];
        $profile = $user->runnerProfile;
        if ($profile) {
            foreach ($profile->documents as $doc) {
                // KYC docs now live on the private kyc disk (file_path); legacy
                // rows still carry a public file_url. Erase whichever applies so
                // a deleted account never leaves an identity document behind.
                if ($doc->file_path) {
                    $kycFilesToDelete[] = $doc->file_path;
                } elseif ($doc->file_url) {
                    $filesToDelete[] = $this->publicDiskPath($doc->file_url);
                }
            }
        }
        if ($user->avatar_url) {
            $filesToDelete[] = $this->publicDiskPath($user->avatar_url);
        }

        \Illuminate\Support\Facades\DB::transaction(function () use ($user, $profile) {
            if ($profile) {
                // KYC identity documents (gov ID / selfie / licence). Deleting
                // the rows (files below) also clears a deleted runner's
                // world-readable documents — mitigating SEC-1 for the account.
                $profile->documents()->delete();
                $profile->update([
                    'bank_name' => null,
                    'bank_account_number' => null,
                    'ewallet_number' => null,
                    'payout_channel_code' => null,
                ]);
            }

            // Pure-PII child rows — no financial value.
            $user->savedAddresses()->delete();
            $user->trustedContacts()->delete();

            // Redact the contact PII the user entered on THEIR OWN (customer)
            // bookings — keep the booking (financial record), drop the personal
            // contact details. Scoped to their own bookings so another party's
            // PII on a shared booking is never touched.
            $bookingIds = \App\Models\Booking::where('customer_id', $user->id)->pluck('id');
            if ($bookingIds->isNotEmpty()) {
                \App\Models\Booking::whereIn('id', $bookingIds)->update([
                    'pickup_contact_name' => null,
                    'pickup_contact_phone' => null,
                    'dropoff_contact_name' => null,
                    'dropoff_contact_phone' => null,
                ]);
                \App\Models\BookingStop::whereIn('booking_id', $bookingIds)->update([
                    'contact_name' => null,
                    'contact_phone' => null,
                ]);
            }

            // Anonymize the account row itself.
            $user->update([
                'full_name' => 'Deleted User',
                'email' => null,
                'phone' => null,
                'avatar_url' => null,
                'fcm_token' => null,
                'default_lat' => null,
                'default_lng' => null,
            ]);

            // Revoke all API tokens, and drop every registered push device (the
            // FK cascade only fires on a HARD delete, and this is a soft delete)
            // so a deleted account stops receiving pushes.
            $user->tokens()->delete();
            $user->deviceTokens()->delete();

            // Soft delete the account.
            $user->delete();
        });

        // Remove the collected PII files from disk (best-effort, post-commit).
        foreach ($filesToDelete as $path) {
            if ($path !== '' && $path !== null) {
                Storage::disk('public')->delete($path);
            }
        }
        foreach ($kycFilesToDelete as $path) {
            if ($path !== '' && $path !== null) {
                Storage::disk('kyc')->delete($path);
            }
        }

        return response()->json([
            'message' => 'Account deleted successfully.',
        ]);
    }

    /**
     * Turn a public-disk file URL into a disk-relative path, independent of the
     * APP_URL it was generated under — public URLs are always ".../storage/{path}",
     * so a later domain change can't leave a gov-ID / avatar file undeletable
     * (a plain str_replace of the current base URL would silently no-op then).
     */
    private function publicDiskPath(string $url): ?string
    {
        $path = parse_url($url, PHP_URL_PATH);
        if (! is_string($path) || $path === '') {
            return null;
        }

        // Strip the leading "/storage/" public-disk symlink prefix.
        return preg_replace('#^storage/#', '', ltrim($path, '/'));
    }
}
