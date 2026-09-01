<?php

namespace App\Services;

use App\Events\NotificationCreated;
use App\Models\DeviceToken;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class NotificationService
{
    /**
     * Expo accepts up to 100 push messages (or, for one message, up to 100
     * `to` tokens) per HTTP request. Fan-outs are chunked to this size so a
     * broadcast costs ceil(devices / 100) round trips instead of one per user.
     */
    private const EXPO_BATCH_SIZE = 100;

    /**
     * Rows per bulk INSERT, so a 200-runner fan-out stays well inside any
     * driver placeholder limit.
     */
    private const INSERT_CHUNK_SIZE = 100;

    public function sendPush(string $userId, string $title, string $body, array $data = []): void
    {
        if (!User::whereKey($userId)->exists()) {
            return;
        }

        // ALWAYS persist + broadcast the in-app notification first (see
        // notifyInApp) — it reaches the app live over the
        // `notifications.{userId}` Reverb channel even for users who never
        // granted push permission. The remote device push is a best-effort extra.
        $this->notifyInApp($userId, $title, $body, $data);
        $this->sendRemotePush($userId, $title, $body, $data);
    }

    /**
     * Send ONLY a device push (Expo/FCM) to a user's registered devices — no
     * in-app notification row and no broadcast. Use for events that should wake
     * the device but must NOT fill the in-app notifications inbox: either
     * because the message belongs elsewhere (a chat message lives in the chat
     * thread) or because its in-app surface is delivered separately (a live job
     * offer card via notifyInApp). Fans out to every registered device.
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

    /**
     * Device-only push (no in-app rows, no broadcast) to MANY users at once —
     * the same message to everybody.
     *
     * The per-user sendRemotePush() costs 2 queries + at least one blocking
     * HTTP round trip EACH, so calling it in a loop over a large audience (the
     * negotiate offer fan-out: up to 200 nearby runners) pins the queue worker
     * for minutes and lights up the last runner's phone long after the first —
     * by which time the errand is usually taken. This collapses the same work
     * into: one device_tokens query, one users query for the legacy-column
     * stragglers, and ceil(expoDevices / 100) Expo requests.
     *
     * Best-effort, exactly like sendRemotePush: every send is individually
     * try/caught downstream, so a push failure never fails the caller.
     *
     * @param  array<int,string>  $userIds
     */
    public function sendRemotePushToMany(array $userIds, string $title, string $body, array $data = []): void
    {
        $userIds = array_values(array_unique(array_filter($userIds)));
        if (empty($userIds)) {
            return;
        }

        // ONE query for every registered device across the whole audience
        // (replaces N × `$user->deviceTokens()->pluck()`).
        $devices = DeviceToken::whereIn('user_id', $userIds)->get(['user_id', 'token']);
        $tokens = $devices->pluck('token')->all();

        // Same legacy fallback sendRemotePush() applies, batched: users who
        // registered before device_tokens existed still carry a token on the
        // old column. Only asked for the users that have no device row.
        $missing = array_values(array_diff($userIds, $devices->pluck('user_id')->all()));
        if (! empty($missing)) {
            $tokens = array_merge(
                $tokens,
                User::whereIn('id', $missing)->whereNotNull('fcm_token')->pluck('fcm_token')->all(),
            );
        }

        $tokens = array_values(array_unique(array_filter($tokens)));
        if (empty($tokens)) {
            return;
        }

        $expoTokens = array_values(array_filter($tokens, fn ($t) => str_starts_with($t, 'ExponentPushToken')));
        $fcmTokens = array_values(array_filter($tokens, fn ($t) => ! str_starts_with($t, 'ExponentPushToken')));

        // One request per 100 devices — Expo's documented per-request cap.
        foreach (array_chunk($expoTokens, self::EXPO_BATCH_SIZE) as $chunk) {
            $this->sendExpoPush($chunk, $title, $body, $data);
        }
        // FCM has no batched path here (kreait sends per token), unchanged.
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
     * a negotiate offer fanned out to many nearby runners, a PIN-verified
     * confirmation. These paths formerly wrote to a realtime table over
     * PostgREST and relied on the client's table subscription; that path is
     * gone — they now fan out over the `NotificationCreated` Reverb broadcast,
     * so route them through here instead.
     * sendPush() layers a remote push on top of this.
     */
    public function notifyInApp(string $userId, string $title, string $body, array $data = []): Notification
    {
        $notification = Notification::create([
            'user_id' => $userId,
            'title' => $title,
            'body' => $body,
            'type' => $data['type'] ?? 'system',
            'data' => $data,
            'is_read' => false,
        ]);

        // Queued broadcast — mirrors what the old `notifications` table
        // subscription delivered before the migration to Reverb.
        NotificationCreated::dispatch($notification);

        return $notification;
    }

    /**
     * notifyInApp() for MANY users at once: one bulk INSERT of the identical
     * card for every recipient, then the SAME per-user `NotificationCreated`
     * Reverb broadcast notifyInApp() dispatches — so each recipient's live
     * stream is unchanged; only the write is batched (200 inserts → 2).
     *
     * Callers own dedup, exactly as with notifyInApp(): this inserts one row
     * per id it is handed, so pass a de-duplicated, already-filtered list.
     *
     * @param  array<int,string>  $userIds
     * @return Collection<int,Notification>
     */
    public function notifyInAppMany(array $userIds, string $title, string $body, array $data = []): Collection
    {
        $userIds = array_values(array_unique(array_filter($userIds)));
        if (empty($userIds)) {
            return collect();
        }

        $now = now();
        $encoded = json_encode($data);
        $prototype = new Notification();

        $rows = array_map(fn (string $userId) => [
            // A bulk insert never builds a model, so HasUuids never assigns a
            // key — mint the very same ordered UUID it would have.
            'id' => $prototype->newUniqueId(),
            'user_id' => $userId,
            'title' => $title,
            'body' => $body,
            'type' => $data['type'] ?? 'system',
            // Insert bypasses casts — hand the driver the encoded JSON.
            'data' => $encoded,
            'is_read' => false,
            // The column defaults to CURRENT_TIMESTAMP (the model has
            // $timestamps = false), but set it explicitly so the rows we
            // broadcast carry the same created_at the DB stored.
            'created_at' => $now,
        ], $userIds);

        foreach (array_chunk($rows, self::INSERT_CHUNK_SIZE) as $chunk) {
            Notification::insert($chunk);
        }

        // hydrate() fills raw attributes (no cast-on-write), so `data` decodes
        // back to an array on read and NotificationResource — the broadcast
        // payload — is byte-for-byte what notifyInApp() would have produced.
        $notifications = Notification::hydrate($rows);

        foreach ($notifications as $notification) {
            NotificationCreated::dispatch($notification);
        }

        return $notifications;
    }

    public function sendToTopic(string $topic, string $title, string $body, array $data = []): void
    {
        try {
            $messaging = app('firebase.messaging');
            $message = \Kreait\Firebase\Messaging\CloudMessage::withTarget('topic', $topic)
                ->withNotification([
                    'title' => $title,
                    'body' => $body,
                ])
                ->withData($data);

            $messaging->send($message);
        } catch (\Throwable $e) {
            Log::error('FCM topic push failed', [
                'topic' => $topic,
                'error' => $e->getMessage(),
            ]);
        }
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
