<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\DeviceSessions;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

class LoginController extends Controller
{
    /**
     * A bcrypt hash of nothing in particular, at the production cost
     * (BCRYPT_ROUNDS=12), checked against when there is no such account.
     * Fixed rather than made per request, which would cost twice as much.
     */
    private const NO_ACCOUNT_HASH = '$2y$12$cs2fzf/cnHCIamkVd3QsP./pihML/bKTuersDRUWlM/9xvaT9X4T6';

    public function login(LoginRequest $request): JsonResponse
    {
        // Never log the raw phone/email (CWE-532: plaintext contact PII in the
        // daily log files, readable by anyone with log/backup access). ip +
        // the request_id attached via AssignRequestId are enough to triage.
        Log::info('Login attempt', [
            'ip' => $request->ip(),
        ]);

        $request->ensureIsNotRateLimited();

        $user = User::when($request->phone, fn ($q) => $q->where('phone', $request->phone))
            ->when($request->email, fn ($q) => $q->where('email', $request->email))
            ->first();

        // Check a password even when there is no such account, so a wrong
        // address answers as slowly as a wrong password: skipping the hash
        // answered measurably faster and told anyone which phones and emails
        // have accounts.
        $passwordMatches = Hash::check(
            (string) $request->password,
            $user?->password_hash ?? self::NO_ACCOUNT_HASH,
        );

        if (! $user || ! $passwordMatches) {
            Log::warning('Login failed - invalid credentials', [
                'user_found' => (bool) $user,
                'ip' => $request->ip(),
            ]);

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

        // One sign-in per device: signing in again on this phone replaces its
        // own previous sign-in, never another phone's.
        $token = DeviceSessions::issueToken($user, $request, replaceSameName: true);
        $user->update(['last_active_at' => now()]);

        Log::info('Login successful', [
            'user_id' => $user->id,
            'role' => $user->role,
            'ip' => $request->ip(),
        ]);

        // The account belongs to the caller, so render the self-view (email /
        // verified flags / wallet). The request isn't authenticated yet here,
        // so without this UserResource would treat the owner as a third party
        // and strip their own PII from the login response.
        request()->setUserResolver(fn () => $user);

        return response()->json([
            'user' => new UserResource($user->load('runnerProfile')),
            'token' => $token,
        ]);
    }
}
