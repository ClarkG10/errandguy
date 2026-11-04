<?php

namespace App\Http\Controllers\Customer;

use App\Enums\BookingStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Requests\UploadAvatarRequest;
use App\Http\Resources\UserResource;
use App\Models\RunnerProfile;
use App\Services\AccountErasureService;
use App\Support\CashDebtPolicy;
use App\Support\DeviceSessions;
use App\Support\ErrorCode;
use App\Support\PayoutDestination;
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
        $data = $request->validated();

        // Switching between customer and runner mode mid-errand hides a live
        // errand from the person working it or paying for it (each mode only
        // has screens for its own side). The app blocks it; this is the
        // server's copy of that rule, so an older build or a retried request
        // can't slip through.
        $switchingTo = isset($data['role']) && $data['role'] !== $user->role ? $data['role'] : null;
        if ($switchingTo !== null && ($blocked = $this->roleSwitchBlocker($user, $switchingTo))) {
            return $this->fail(ErrorCode::BOOKING_CONFLICT, $blocked);
        }

        // A changed contact must lose its verified badge until re-confirmed via
        // OTP. Otherwise editing your email/phone keeps the "verified" checkmark
        // on an unconfirmed value. Server-controlled (added here, not from input),
        // both flags are $fillable, nothing hard-gates on them, and the OTP
        // re-verify path restores them — so this is a safe trust correction.
        if (array_key_exists('email', $data) && $data['email'] !== $user->email) {
            $data['email_verified'] = false;
        }
        if (array_key_exists('phone', $data) && $data['phone'] !== $user->phone) {
            $data['phone_verified'] = false;
        }

        $user->update($data);

        // Auto-create runner profile when role is changed to runner
        if ($request->validated('role') === 'runner' && !$user->runnerProfile) {
            RunnerProfile::create([
                'user_id' => $user->id,
                'verification_status' => 'pending',
            ]);
        }

        // Leaving runner mode takes them offline, so matching stops offering
        // errands to an app that no longer shows a runner screen.
        if ($switchingTo === 'customer') {
            RunnerProfile::switchOffline($user->id);
        }

        return response()->json([
            'data' => new UserResource($user->fresh()->load('runnerProfile.documents')),
            'message' => 'Profile updated successfully.',
        ]);
    }

    /**
     * Why this user can't switch to $role right now, or null when they can.
     * Mirrors the app's own guards: a customer with an errand still open
     * (the same set GET /bookings/active lists) can't become a runner, and a
     * runner holding an offer or an errand can't become a customer.
     */
    private function roleSwitchBlocker(\App\Models\User $user, string $role): ?string
    {
        if ($role === 'runner' && $user->customerBookings()->active()->exists()) {
            return 'You have an errand in progress. Wait until it’s finished or cancel it before switching to runner mode.';
        }

        if ($role === 'customer'
            && $user->runnerBookings()->whereIn('status', BookingStatus::RUNNER_HELD)->exists()) {
            return 'You have an errand in progress. Finish it (or decline the offer) before switching to customer mode.';
        }

        return null;
    }

    public function uploadAvatar(UploadAvatarRequest $request): JsonResponse
    {
        $user = $request->user();
        $file = $request->file('avatar');

        // Delete old avatar if it exists. Use the canonical publicDiskPath()
        // helper (same as deleteAccount) — it strips the "/storage/" symlink
        // prefix to the true relative path ('avatars/…'). The previous inline
        // ltrim left 'storage/avatars/…', which resolved to nothing and (with the
        // disk's throw=>false) silently no-op'd, orphaning every prior avatar.
        if ($user->avatar_url && $oldPath = $this->publicDiskPath($user->avatar_url)) {
            Storage::disk('public')->delete($oldPath);
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
            'fcm_token' => ['required', 'string', 'max:255'],
            'platform' => ['sometimes', 'nullable', 'string', 'max:15'],
            'device_id' => ['sometimes', 'nullable', 'string', 'max:255'],
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
        // just re-points the row instead of duplicating it. The device_id (sent,
        // or the one this sign-in was issued to) lets sign-out drop this
        // registration without the app having to send its push token.
        $deviceId = $request->input('device_id');
        $deviceId = is_string($deviceId) && preg_match(DeviceSessions::DEVICE_ID_PATTERN, $deviceId) === 1
            ? $deviceId
            : DeviceSessions::deviceIdOf(DeviceSessions::currentToken($request));

        \App\Models\DeviceToken::updateOrCreate(
            ['token' => $token],
            [
                'user_id' => $user->id,
                'platform' => $request->input('platform'),
                'device_id' => $deviceId,
                'last_used_at' => now(),
            ],
        );

        return response()->json([
            'message' => 'FCM token updated successfully.',
        ]);
    }

    /**
     * DELETE /user/account — erase the account.
     *
     * Money first, so none is ever stranded in an erased account:
     *   • a POSITIVE withdrawable balance is paid out as part of the deletion:
     *     the request says where (channel, account_number, account_name, and
     *     bank_name for a runner's bank account — a runner's saved payout
     *     method is used when it doesn't), and the FULL balance is queued as a
     *     pending payout in the same locked step that erases the account. Staff
     *     send it from the Payouts queue as usual; the destination is recorded
     *     on the payout itself, because the account's own details are erased;
     *   • a NEGATIVE balance is money owed from cash errands, and is refused —
     *     erasing the identity would make it uncollectable;
     *   • bonus credit (non-withdrawable) never blocks; it lapses with the
     *     account.
     *
     * The erasure itself is AccountErasureService, shared with the staff
     * "Erase account" action for requests made without the app.
     */
    public function deleteAccount(Request $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        // Ask where to send a remaining balance only after the quick check
        // that nothing is in flight (the service checks again under its lock).
        if (\App\Models\Booking::where(fn ($q) => $q->where('customer_id', $user->id)->orWhere('runner_id', $user->id))
            ->whereNotIn('status', BookingStatus::ENDED)
            ->exists()) {
            return $this->activeErrandRefusal();
        }

        $validated = $request->validate(
            PayoutDestination::rules($request->input('channel'), allowBank: $profile !== null, required: false),
            PayoutDestination::messages(allowBank: $profile !== null),
        );

        $destination = filled($validated['channel'] ?? null)
            ? PayoutDestination::fromInput($validated)
            : null; // the service falls back to the runner's saved details

        $outcome = app(AccountErasureService::class)->erase($user, $destination);

        if ($outcome['status'] === 'active_errand') {
            return $this->activeErrandRefusal();
        }

        if ($outcome['status'] === 'debt') {
            // Someone leaving won't earn their way out of the debt, so say how
            // else to settle it.
            return $this->fail(
                ErrorCode::CASH_DEBT_OUTSTANDING,
                CashDebtPolicy::message($outcome['balance']).' You can delete your account once it’s cleared — '
                    .'to settle it now, contact support at '.config('app.support_email').'.',
            );
        }

        if ($outcome['status'] === 'needs_destination') {
            return $this->fail(
                ErrorCode::PAYOUT_METHOD_REQUIRED,
                'Your wallet has ₱'.number_format($outcome['balance'], 2).'. Tell us where to send it — '
                    .($profile ? 'a GCash or Maya number, or a bank account' : 'a GCash or Maya number')
                    .' — and we’ll send it to you as part of deleting your account.',
                errors: ['channel' => ['Choose where to send your remaining balance.']],
            );
        }

        $payout = $outcome['payout'] ?? null;

        return $this->ok(
            $payout ? [
                'payout' => [
                    'id' => $payout->id,
                    'amount' => abs((float) $payout->amount),
                    'status' => $payout->status,
                    'destination' => PayoutDestination::label($payout->payout_destination),
                ],
            ] : null,
            $payout
                ? 'Account deleted. ₱'.number_format(abs((float) $payout->amount), 2).' is on its way to '
                    .PayoutDestination::label($payout->payout_destination).' — it usually arrives within 1–3 business days.'
                : 'Account deleted successfully.',
        );
    }

    private function activeErrandRefusal(): JsonResponse
    {
        return response()->json([
            'message' => 'You have an active errand in progress. Please complete or cancel it before deleting your account.',
        ], 422);
    }

    /**
     * Turn a public-disk file URL into a disk-relative path, independent of the
     * APP_URL it was generated under — public URLs are always ".../storage/{path}",
     * so a later domain change can't leave an avatar file undeletable (a plain
     * str_replace of the current base URL would silently no-op then).
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
