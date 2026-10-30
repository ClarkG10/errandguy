<?php

namespace App\Services\Sms;

use Illuminate\Support\Facades\Log;

/**
 * The SMS sender used until SEMAPHORE_API_KEY is set: it sends NOTHING and says
 * so. It never reports a number as accepted, so nothing downstream can claim a
 * text went out. Logs only a count — never the numbers or the message, which
 * can carry a live-location link.
 */
class LogSmsSender implements SmsSender
{
    public const NOT_CONFIGURED = 'SMS is not set up (SEMAPHORE_API_KEY is empty), so no text was sent.';

    public function isConfigured(): bool
    {
        return false;
    }

    public function send(array $numbers, string $message): SmsResult
    {
        Log::warning('SMS not sent: no SMS provider is configured', [
            'recipients' => count($numbers),
        ]);

        return SmsResult::failed(self::NOT_CONFIGURED);
    }
}
