<?php

namespace App\Http\Controllers\Customer;

use App\Enums\BookingStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Requests\UploadAvatarRequest;
use App\Http\Resources\UserResource;
use App\Models\Review;
use App\Models\RunnerProfile;
use App\Models\SOSAlert;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\WalletTransaction;
use App\Services\WalletService;
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
    /** What a deleted account's support messages and ticket subjects become. */
    private const ERASED_TEXT = '[Deleted with the account]';

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
     */
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
            ->whereNotIn('status', BookingStatus::ENDED)
            ->exists();

        if ($hasActive) {
            return response()->json([
                'message' => 'You have an active errand in progress. Please complete or cancel it before deleting your account.',
            ], 422);
        }

        $profile = $user->runnerProfile;
        $validated = $request->validate(
            PayoutDestination::rules($request->input('channel'), allowBank: $profile !== null, required: false),
            PayoutDestination::messages(allowBank: $profile !== null),
        );

        $destination = filled($validated['channel'] ?? null)
            ? PayoutDestination::fromInput($validated)
            : $profile?->payoutDestination($user->full_name);

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

        $outcome = \Illuminate\Support\Facades\DB::transaction(function () use ($user, $profile, $destination) {
            // The balance is decided under the account's row lock, so a payout,
            // earning or refund landing at the same moment can't slip past it.
            $locked = \App\Models\User::whereKey($user->id)->lockForUpdate()->first();
            if (! $locked) {
                return ['deleted' => true]; // a racing request already erased it
            }

            $balance = round((float) $locked->wallet_balance, 2);
            if ($balance < 0) {
                return ['error' => 'debt', 'balance' => $balance];
            }

            $payout = null;
            if ($balance > 0) {
                if ($destination === null) {
                    return ['error' => 'destination', 'balance' => $balance];
                }

                $payout = app(WalletService::class)->createPendingPayout(
                    $locked->id,
                    $balance,
                    (string) Str::uuid(),
                    $destination,
                    0.0,
                    'Withdrawal on account deletion',
                );
            }

            if ($profile) {
                // A payout requested before payout details were recorded on the
                // payout itself is sent to the profile's details, which are
                // about to be erased: copy them onto it first, or staff would
                // have nowhere to send it.
                $profileDestination = $profile->payoutDestination($user->full_name);
                if ($profileDestination !== null) {
                    WalletTransaction::where('user_id', $user->id)
                        ->where('type', 'payout')
                        ->where('status', 'pending')
                        ->whereNull('payout_destination')
                        ->get()
                        ->each(fn (WalletTransaction $pending) => $pending->update(['payout_destination' => $profileDestination]));
                }

                // KYC identity documents (gov ID / selfie / licence). Deleting
                // the rows (files below) also clears a deleted runner's
                // world-readable documents — mitigating SEC-1 for the account.
                $profile->documents()->delete();
                $profile->update([
                    'bank_name' => null,
                    'bank_account_number' => null,
                    'ewallet_number' => null,
                    'payout_channel_code' => null,
                    'payout_channel' => null,
                    'payout_account_name' => null,
                ]);
            }

            // Pure-PII child rows — no financial value (a legacy linked
            // payment account holds a gateway token, not money).
            $user->savedAddresses()->delete();
            $user->trustedContacts()->delete();
            $user->paymentMethods()->delete();

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

            // What they wrote elsewhere. The rows stay — a support thread, a
            // review's star rating and an SOS record are history the other
            // side and staff still need — but the words and places are erased.
            SupportMessage::where('sender_id', $user->id)
                ->where('sender_type', 'user')
                ->update(['content' => self::ERASED_TEXT, 'image_url' => null]);
            SupportTicket::where('user_id', $user->id)->update(['subject' => self::ERASED_TEXT]);
            // Comments only: the rating is unchanged, so no average moves.
            Review::where('reviewer_id', $user->id)->whereNotNull('comment')->update(['comment' => null]);
            SOSAlert::where('triggered_by', $user->id)->update([
                'trigger_lat' => null,
                'trigger_lng' => null,
                'trigger_accuracy_m' => null,
                'live_link_token' => null,
            ]);
            SOSAlert::where('customer_id', $user->id)->update(['customer_lat' => null, 'customer_lng' => null]);
            SOSAlert::where('runner_id', $user->id)->update(['runner_lat' => null, 'runner_lng' => null]);

            // Anonymize the account row itself. Only these columns are written
            // (the balance was just debited through the ledger on its own row).
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

            return ['payout' => $payout];
        });

        if (($outcome['error'] ?? null) === 'debt') {
            return $this->fail(
                ErrorCode::CASH_DEBT_OUTSTANDING,
                CashDebtPolicy::message($outcome['balance']).' You can delete your account once it’s cleared.',
            );
        }

        if (($outcome['error'] ?? null) === 'destination') {
            return $this->fail(
                ErrorCode::PAYOUT_METHOD_REQUIRED,
                'Your wallet has ₱'.number_format($outcome['balance'], 2).'. Tell us where to send it — '
                    .($profile ? 'a GCash or Maya number, or a bank account' : 'a GCash or Maya number')
                    .' — and we’ll send it to you as part of deleting your account.',
                errors: ['channel' => ['Choose where to send your remaining balance.']],
            );
        }

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
