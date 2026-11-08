<?php

namespace App\Services;

use App\Events\NotificationCreated;
use App\Models\DeviceToken;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class NotificationService
{
    public function sendPush(string $userId, string $title, string $body, array $data = []): void
    {
        if (!User::whereKey($userId)->exists()) {
            return;
        }

        // ALWAYS persist + broadcast the in-app notification first (see
        // notifyInApp) — it reaches the app live over the
        // `notifications.{userId}` Reverb channel even for users who never
        // granted push permission. The remote device push is a best-effort extra.
        $row = $this->notifyInApp($userId, $title, $body, $data);
        // The row's id rides on the push so tapping it marks the row read —
        // otherwise every push the user followed stayed unread in the inbox.
        $this->sendRemotePush($userId, $title, $body, $data + ['notification_id' => (string) $row->id]);
    }

    /**
     * Send ONLY a device push (Expo/FCM) to a user's registered devices — no
     * in-app notification row and no broadcast. Use for events that should wake
     * the device but must NOT fill the in-app notifications inbox, because the
     * message belongs elsewhere (a chat message lives in the chat thread). Fans
     * out to every registered device.
     */
    public function sendRemotePush(string $userId, string $title, string $body, array $data = []): void
    {
        $user = User::find($userId);
        if (!$user) {
            return;
        }

        // Fan out to EVERY registered device, not just the most recent one.
        // (The old single fcm_token column was overwritten per device, so only
        // the last-registered device got pushes.)
        $tokens = $user->deviceTokens()->pluck('token')->all();

        // Fallback for users who registered before device_tokens existed (or
        // whose backfill hasn't run yet): the legacy column still holds a token.
        if (empty($tokens) && $user->fcm_token) {
            $tokens = [$user->fcm_token];
        }
        if (empty($tokens)) {
            return;
        }
        $tokens = array_values(array_unique($tokens));

        // Expo tokens support a single batched call (one HTTP request for all of
        // a user's Expo devices); FCM tokens go one at a time via the SDK.
        $expoTokens = array_values(array_filter($tokens, fn ($t) => str_starts_with($t, 'ExponentPushToken')));
        $fcmTokens = array_values(array_filter($tokens, fn ($t) => ! str_starts_with($t, 'ExponentPushToken')));

        if (! empty($expoTokens)) {
            $this->sendExpoPush($expoTokens, $title, $body, $data);
        }
        foreach ($fcmTokens as $fcmToken) {
            $this->sendFCMPush($fcmToken, $title, $body, $data);
        }
    }

    public function sendBulkPush(array $userIds, string $title, string $body, array $data = []): void
    {
        foreach ($userIds as $userId) {
            $this->sendPush($userId, $title, $body, $data);
        }
    }

    /**
     * Persist an in-app notification and broadcast it live over the
     * `notifications.{userId}` Reverb channel — WITHOUT sending a remote
     * (Expo/FCM) device push.
     *
     * Use this for updates that must land live in the app but where a device
     * push would be noise or spam — shopping-list ticks, an SOS in-app banner,
     * a PIN-verified confirmation. These paths formerly wrote to a realtime table over
     * PostgREST and relied on the client's table subscription; that path is
     * gone — they now fan out over the `NotificationCreated` Reverb broadcast,
     * so route them through here instead.
     * sendPush() layers a remote push on top of this.
     */
    public function notifyInApp(string $userId, string $title, string $body, array $data = [], bool $read = false): Notification
    {
        $notification = Notification::create([
            'user_id' => $userId,
            // notifications.title holds 100 characters; a longer one would
            // fail the insert and, with it, the push that follows it.
            'title' => \Illuminate\Support\Str::limit($title, 97),
            'body' => $body,
            'type' => $data['type'] ?? 'system',
            'data' => $data,
            'is_read' => $read,
        ]);

        // Queued broadcast — mirrors what the old `notifications` table
        // subscription delivered before the migration to Reverb.
        NotificationCreated::dispatch($notification);

        return $notification;
    }

    /**
     * In-app notify, but COALESCED onto one row per subject.
     *
     * For progress streams the customer receives many times per errand. A
     * shopping checklist is ticked item by item, and each tick called
     * notifyInApp — which persists a row — so a 40-item list dropped 40
     * identical "Shopping list updated" cards into the Alerts inbox and buried
     * everything that actually needed attention. The intent was always the LIVE
     * BROADCAST (the tracking screen patches its checklist straight from the
     * payload); the inbox rows were an accepted side effect of the delivery
     * mechanism, not a design goal.
     *
     * Deliberately keeps ONE row rather than none: the inbox already types and
     * categorises these ("Shopping"), and a customer who was away genuinely
     * wants to know the list moved — once, showing the latest state.
     *
     * `created_at` is bumped on purpose. The inbox sorts by it, so leaving it
     * alone would refresh the card's contents while it stayed buried wherever
     * it first landed. Re-marked unread for the same reason: the payload
     * changed, so it is new information.
     *
     * Falls back to a plain notifyInApp when there is no subject to coalesce on,
     * so a missing booking_id can never silently drop the notification.
     */
    public function notifyInAppCoalesced(
        string $userId,
        string $title,
        string $body,
        array $data = [],
        string $subjectKey = 'booking_id',
    ): Notification {
        $type = $data['type'] ?? 'system';
        $subject = $data[$subjectKey] ?? null;

        if (blank($subject)) {
            return $this->notifyInApp($userId, $title, $body, $data);
        }

        // Bounded scan of this user's recent rows OF THIS TYPE, then matched on
        // the subject in PHP — the subject lives inside the JSON `data` column,
        // which is not indexable, while (user_id, created_at) and
        // (type, created_at) both are.
        $existing = Notification::query()
            ->where('user_id', $userId)
            ->where('type', $type)
            ->whereNull('archived_at')
            ->orderByDesc('created_at')
            ->limit(20)
            ->get()
            ->first(fn (Notification $n) => ($n->data[$subjectKey] ?? null) === $subject);

        if (! $existing) {
            return $this->notifyInApp($userId, $title, $body, $data);
        }

        // forceFill, not update(): `created_at` is not in Notification's
        // $fillable, so a mass-assign silently DROPS it — the card would keep
        // its original timestamp and stay buried while its contents changed.
        // Every value here is server-controlled, so bypassing the guard is safe.
        $existing->forceFill([
            'title' => $title,
            'body' => $body,
            'data' => $data,
            'is_read' => false,
            'created_at' => now(),
        ])->save();

        // Re-broadcast so the live consumers (the tracking screen's checklist,
        // the unread badge) see the update exactly as they would a new row.
        NotificationCreated::dispatch($existing);

        return $existing;
    }

    /**
     * @param  array<int,string>  $tokens  one or more Expo push tokens
     */
    private function sendExpoPush(array $tokens, string $title, string $body, array $data): void
    {
        if (empty($tokens)) {
            return;
        }

        try {
            // Expo accepts `to` as an array → one request delivers to every
            // device and returns a tickets array aligned to the tokens.
            //
            // Bound the call (connect 3s, total 8s). Guzzle's default is to wait
            // INDEFINITELY, so a slow/hung exp.host would otherwise pin whatever
            // thread this runs on — and on the webhook path that would delay the
            // ACK to Xendit into a redelivery. This mirrors the 2s Reverb-publish
            // timeout config/broadcasting.php already sets for the same reason.
            $response = Http::connectTimeout(3)->timeout(8)->post('https://exp.host/--/api/v2/push/send', [
                'to' => $tokens,
                'title' => $title,
                'body' => $body,
                'data' => $data,
                'sound' => 'default',
                'priority' => 'high',
                'channelId' => 'default',
            ]);

            // Http::post does NOT throw on a 4xx/5xx, so a rejected batch (bad
            // payload, auth, rate limit) would otherwise vanish silently.
            if (! $response->successful()) {
                Log::error('Expo push HTTP error', [
                    'status' => $response->status(),
                    'body' => \Illuminate\Support\Str::limit($response->body(), 500),
                    'count' => count($tokens),
                ]);

                return;
            }

            $tickets = $response->json('data') ?? [];

            // Surface per-ticket failures other than DeviceNotRegistered (which
            // pruneInvalidExpoTokens handles) — e.g. InvalidCredentials (a broken
            // FCM/APNs setup), MessageTooBig, MessageRateExceeded — instead of
            // dropping them silently.
            foreach ($tickets as $ticket) {
                if (is_array($ticket) && ($ticket['status'] ?? null) === 'error') {
                    $err = $ticket['details']['error'] ?? null;
                    if ($err !== 'DeviceNotRegistered') {
                        Log::warning('Expo push ticket error', [
                            'error' => $err,
                            'message' => $ticket['message'] ?? null,
                        ]);
                    }
                }
            }

            $this->pruneInvalidExpoTokens($tokens, $tickets);
        } catch (\Throwable $e) {
            Log::error('Expo push notification failed', [
                'count' => count($tokens),
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Delete device tokens Expo reported as permanently unusable
     * (DeviceNotRegistered) so the fan-out doesn't keep spraying dead tokens.
     * The tickets array is positionally aligned to the tokens we sent.
     *
     * @param  array<int,string>  $tokens
     * @param  array<int,mixed>  $tickets
     */
    private function pruneInvalidExpoTokens(array $tokens, array $tickets): void
    {
        $dead = [];
        foreach ($tickets as $i => $ticket) {
            $status = is_array($ticket) ? ($ticket['status'] ?? null) : null;
            $error = is_array($ticket) ? ($ticket['details']['error'] ?? null) : null;
            if ($status === 'error' && $error === 'DeviceNotRegistered' && isset($tokens[$i])) {
                $dead[] = $tokens[$i];
            }
        }

        if (! empty($dead)) {
            \App\Models\DeviceToken::whereIn('token', $dead)->delete();
        }
    }

    private function sendFCMPush(string $token, string $title, string $body, array $data): void
    {
        try {
            $messaging = app('firebase.messaging');
            $message = \Kreait\Firebase\Messaging\CloudMessage::withTarget('token', $token)
                ->withNotification([
                    'title' => $title,
                    'body' => $body,
                ])
                ->withData($data);

            $messaging->send($message);
        } catch (\Throwable $e) {
            Log::error('FCM push notification failed', [
                'error' => $e->getMessage(),
            ]);
        }
    }
}
