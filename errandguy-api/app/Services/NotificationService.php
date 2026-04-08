<?php

namespace App\Services;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class NotificationService
{
    public function sendPush(string $userId, string $title, string $body, array $data = []): void
    {
        $user = User::find($userId);
        if (!$user || !$user->fcm_token) {
            return;
        }

        Notification::create([
            'user_id' => $userId,
            'title' => $title,
            'body' => $body,
            'type' => $data['type'] ?? 'system',
            'data' => $data,
            'is_read' => false,
        ]);

        $token = $user->fcm_token;

        if (str_starts_with($token, 'ExponentPushToken')) {
            $this->sendExpoPush($token, $title, $body, $data);
        } else {
            $this->sendFCMPush($token, $title, $body, $data);
        }
    }

    public function sendBulkPush(array $userIds, string $title, string $body, array $data = []): void
    {
        foreach ($userIds as $userId) {
            $this->sendPush($userId, $title, $body, $data);
        }
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

    private function sendExpoPush(string $token, string $title, string $body, array $data): void
    {
        try {
            Http::post('https://exp.host/--/api/v2/push/send', [
                'to' => $token,
                'title' => $title,
                'body' => $body,
                'data' => $data,
                'sound' => 'default',
                'priority' => 'high',
                'channelId' => 'default',
            ]);
        } catch (\Throwable $e) {
            Log::error('Expo push notification failed', [
                'token' => substr($token, 0, 20) . '...',
                'error' => $e->getMessage(),
            ]);
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
