<?php

namespace App\Services\Sms;

use App\Support\PhilippinePhone;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * SMS through Semaphore (semaphore.co), a Philippine SMS gateway.
 *
 * API as documented at https://semaphore.co/docs (checked 2026-10-31):
 *   POST https://api.semaphore.co/api/v4/messages   — normal queue, 120 calls/min
 *   POST https://api.semaphore.co/api/v4/priority   — "bypasses the default
 *        message queue and sends the message immediately", not rate limited,
 *        2 credits per 160 characters; same parameters and response
 *   Form fields: apikey (required), number (required; comma-separated, up to
 *   1000 per call), message (required; over 160 characters is split
 *   automatically), sendername (optional; defaults to the account's registered
 *   sender name — an error if there is none).
 *   Response: JSON, one object per message, with message_id, recipient (as
 *   639XXXXXXXXX), status (Queued | Pending | Sent | Failed | Refunded), …
 *   The error body is not documented, so anything other than a 2xx carrying
 *   message objects is treated as "nothing was sent".
 *
 * Emergency texts use the priority queue by default (SEMAPHORE_PRIORITY).
 * The API key, the numbers and the message text are never logged.
 */
class SemaphoreSmsSender implements SmsSender
{
    /** Statuses meaning the provider took the message for delivery. */
    private const ACCEPTED_STATUSES = ['queued', 'pending', 'sent'];

    public function __construct(
        private readonly string $apiKey,
        private readonly ?string $senderName = null,
        private readonly bool $priority = true,
        private readonly string $baseUrl = 'https://api.semaphore.co/api/v4',
        private readonly int $timeoutSeconds = 10,
    ) {}

    public function isConfigured(): bool
    {
        return $this->apiKey !== '';
    }

    public function send(array $numbers, string $message): SmsResult
    {
        $recipients = [];
        foreach ($numbers as $number) {
            $normalised = PhilippinePhone::normalize($number);
            if ($normalised !== null) {
                $recipients[] = $normalised;
            }
        }
        $recipients = array_values(array_unique($recipients));

        if ($recipients === []) {
            return SmsResult::failed('No valid Philippine mobile number to text.');
        }

        $form = [
            'apikey' => $this->apiKey,
            'number' => implode(',', $recipients),
            'message' => $message,
        ];
        if (filled($this->senderName)) {
            $form['sendername'] = $this->senderName;
        }

        $endpoint = rtrim($this->baseUrl, '/').($this->priority ? '/priority' : '/messages');

        try {
            $response = Http::asForm()
                ->acceptJson()
                ->connectTimeout(5)
                ->timeout($this->timeoutSeconds)
                ->post($endpoint, $form);
        } catch (ConnectionException $e) {
            Log::error('Semaphore SMS send failed: could not reach Semaphore', [
                'recipients' => count($recipients),
                'error' => $e->getMessage(),
            ]);

            return SmsResult::failed('Could not reach the SMS provider.');
        }

        if (! $response->successful()) {
            Log::error('Semaphore SMS send rejected', [
                'recipients' => count($recipients),
                'status' => $response->status(),
                'body' => mb_substr((string) $response->body(), 0, 300),
            ]);

            return SmsResult::failed('The SMS provider refused the message (HTTP '.$response->status().').');
        }

        $messages = $response->json();
        if (is_array($messages) && array_key_exists('message_id', $messages)) {
            $messages = [$messages];
        }
        if (! is_array($messages)) {
            Log::error('Semaphore SMS send returned an unexpected response', [
                'recipients' => count($recipients),
                'status' => $response->status(),
            ]);

            return SmsResult::failed('The SMS provider sent back an unexpected answer.');
        }

        $accepted = [];
        foreach ($messages as $sent) {
            if (! is_array($sent) || empty($sent['message_id'])) {
                continue;
            }
            $status = strtolower((string) ($sent['status'] ?? ''));
            $recipient = PhilippinePhone::normalize(isset($sent['recipient']) ? (string) $sent['recipient'] : null);
            if ($recipient !== null && in_array($status, self::ACCEPTED_STATUSES, true)) {
                $accepted[] = $recipient;
            }
        }
        $accepted = array_values(array_unique($accepted));

        if ($accepted === []) {
            // Statuses only: the message objects echo the numbers and the text,
            // which can carry a live-location link.
            Log::error('Semaphore SMS send accepted no recipient', [
                'recipients' => count($recipients),
                'statuses' => array_values(array_map(
                    fn ($sent) => is_array($sent) ? ($sent['status'] ?? null) : null,
                    $messages,
                )),
            ]);

            return SmsResult::failed('The SMS provider did not accept the message.');
        }

        return new SmsResult($accepted);
    }
}
