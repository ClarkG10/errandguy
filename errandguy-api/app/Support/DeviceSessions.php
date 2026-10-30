<?php

namespace App\Support;

use App\Models\DeviceToken;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Sign-ins (Sanctum tokens) and push registrations (device_tokens), per device.
 *
 * A sign-in from an app that sends `device_id` is named "device:{device_id}"
 * (plus "|{device_name}" when given), so signing in again on the SAME phone
 * replaces only that phone's sign-in — a second phone of the same model keeps
 * its own. Without a device_id the old behaviour stands: the token is named by
 * device_name or the User-Agent.
 *
 * A push registration remembers the device_id it was registered from, so
 * signing out of one phone can drop that phone's registration even when the
 * app doesn't send its push token.
 *
 * Anything that drops registrations also clears the legacy users.fcm_token
 * when it points at a dropped device: NotificationService falls back to that
 * column when a user has no device_tokens rows, so leaving it would keep
 * pushing to a phone that was signed out.
 */
final class DeviceSessions
{
    /** What a device_id may contain (UUIDs, Android IDs, vendor IDs). */
    public const DEVICE_ID_PATTERN = '/^[A-Za-z0-9.:-]{8,100}$/';

    private const PREFIX = 'device:';

    /**
     * Loose on purpose: a sign-in must never fail because the phone described
     * itself oddly. A device_id outside DEVICE_ID_PATTERN is simply ignored
     * (old naming), and a long device_name is cut to 100 characters.
     *
     * @return array<string, array<int, string>>
     */
    public static function rules(): array
    {
        return [
            'device_id' => ['sometimes', 'nullable', 'string', 'max:255'],
            'device_name' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    /**
     * Mint a sign-in token for this request's device.
     *
     * With a device_id, the device's previous sign-ins for this user are
     * revoked first (re-signing in on the same phone). Without one,
     * $replaceSameName keeps the login endpoint's old rule of replacing a token
     * with the same name.
     */
    public static function issueToken(User $user, Request $request, bool $replaceSameName = false): string
    {
        $deviceId = self::deviceIdFrom($request);
        $deviceName = trim((string) $request->input('device_name', '')) ?: null;

        if ($deviceId !== null) {
            self::tokensForDevice($user, $deviceId)->delete();

            $name = self::PREFIX.$deviceId.($deviceName !== null ? '|'.mb_substr($deviceName, 0, 100) : '');
        } else {
            $name = mb_substr($deviceName ?? (string) $request->header('User-Agent', 'mobile'), 0, 255) ?: 'mobile';

            if ($replaceSameName) {
                $user->tokens()->where('name', $name)->delete();
            }
        }

        return $user->createToken($name)->plainTextToken;
    }

    /** The device_id a token was issued to, or null for a token named the old way. */
    public static function deviceIdOf(?PersonalAccessToken $token): ?string
    {
        if ($token === null || ! is_string($token->name) || ! str_starts_with($token->name, self::PREFIX)) {
            return null;
        }

        $id = explode('|', substr($token->name, strlen(self::PREFIX)), 2)[0];

        return preg_match(self::DEVICE_ID_PATTERN, $id) === 1 ? $id : null;
    }

    /** The current request's token, when it is a real (database) token. */
    public static function currentToken(Request $request): ?PersonalAccessToken
    {
        $token = $request->user()?->currentAccessToken();

        return $token instanceof PersonalAccessToken ? $token : null;
    }

    /** Sign the user out of every device: all tokens and all push registrations. */
    public static function signOutEverywhere(User $user): void
    {
        $user->tokens()->delete();
        self::forgetAllDevices($user);
        // No sign-in is left to receive an offer, so stop matching them.
        RunnerProfile::switchOffline($user->id);
    }

    /**
     * Drop every push registration except (optionally) the current phone's,
     * matched by its device_id or its push token.
     */
    public static function forgetAllDevices(User $user, ?string $keepDeviceId = null, ?string $keepPushToken = null): void
    {
        $query = DeviceToken::where('user_id', $user->id);

        if ($keepDeviceId !== null) {
            $query->where(fn ($q) => $q->whereNull('device_id')->orWhere('device_id', '!=', $keepDeviceId));
        }
        if ($keepPushToken !== null) {
            $query->where('token', '!=', $keepPushToken);
        }

        $query->delete();

        $kept = DeviceToken::where('user_id', $user->id)->pluck('token')->all();
        if ($user->fcm_token !== null && ! in_array($user->fcm_token, $kept, true)) {
            self::clearLegacyPushToken($user);
        }
    }

    /** Drop one phone's push registration, by push token or by device_id. */
    public static function forgetDevice(User $user, ?string $pushToken, ?string $deviceId): void
    {
        if ($pushToken === null && $deviceId === null) {
            return;
        }

        $dropped = DeviceToken::where('user_id', $user->id)
            ->where(function ($q) use ($pushToken, $deviceId) {
                if ($pushToken !== null) {
                    $q->orWhere('token', $pushToken);
                }
                if ($deviceId !== null) {
                    $q->orWhere('device_id', $deviceId);
                }
            });

        $tokens = (clone $dropped)->pluck('token')->all();
        $dropped->delete();

        if ($pushToken !== null) {
            $tokens[] = $pushToken;
        }

        if ($user->fcm_token !== null && in_array($user->fcm_token, $tokens, true)) {
            self::clearLegacyPushToken($user);
        }
    }

    /** Clear users.fcm_token with a targeted write (nothing else on the model is saved). */
    private static function clearLegacyPushToken(User $user): void
    {
        User::withTrashed()->whereKey($user->getKey())->update(['fcm_token' => null]);
        $user->setAttribute('fcm_token', null);
        $user->syncOriginalAttribute('fcm_token');
    }

    /** Tokens this user holds on one device. */
    private static function tokensForDevice(User $user, string $deviceId)
    {
        return $user->tokens()->where(function ($q) use ($deviceId) {
            // The device_id charset has no LIKE wildcards ('%', '_') and never
            // contains '|', so this prefix matches exactly one device.
            $q->where('name', self::PREFIX.$deviceId)
                ->orWhere('name', 'like', self::PREFIX.$deviceId.'|%');
        });
    }

    private static function deviceIdFrom(Request $request): ?string
    {
        $id = $request->input('device_id');

        return is_string($id) && preg_match(self::DEVICE_ID_PATTERN, $id) === 1 ? $id : null;
    }
}
