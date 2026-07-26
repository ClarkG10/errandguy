<?php

namespace App\Jobs;

use App\Services\NotificationService;

/**
 * Deliver a single-recipient notification (in-app row + Expo/FCM push) OFF the
 * request thread.
 *
 * Used wherever a synchronous request would otherwise block on outbound Expo/FCM
 * latency for a push that has no bearing on the response:
 *   - a runner matched to a fixed-price booking — dispatched from MatchRunnerJob,
 *     which is itself dispatchSync'd inside the customer's create request (P4);
 *   - admin runner-verification approve/reject and dispute resolve (P33).
 *
 * Mirrors the existing ShouldQueue SendBookingStatusNotification listener: the
 * durable state is written by the caller; only the notification is deferred.
 */
class SendPushJob extends BaseJob
{
    public function __construct(
        public string $userId,
        public string $title,
        public string $body,
        public array $data = [],
    ) {}

    public function handle(NotificationService $notifications): void
    {
        $notifications->sendPush($this->userId, $this->title, $this->body, $this->data);
    }
}
