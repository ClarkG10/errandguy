<?php

namespace App\Mail\Transport;

use Google\Auth\FetchAuthTokenInterface;
use GuzzleHttp\Client as GuzzleClient;
use GuzzleHttp\Exception\RequestException;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;

/**
 * Sends mail through the Gmail REST API (`users.messages.send`) as
 * support@errandguyph.com.
 *
 * The transport is credential-agnostic: it takes any google/auth
 * FetchAuthTokenInterface and just needs an access token. AppServiceProvider
 * decides which credential to build:
 *   - OAuth2 user-refresh token (UserRefreshCredentials) — the account that
 *     consented is support@…, so "me" sends as it. No service-account key,
 *     which is what we use because the org policy blocks SA key creation.
 *   - Service account + domain-wide delegation (ServiceAccountCredentials with
 *     a `sub`) — kept as an alternative if a key ever becomes available.
 *
 * We deliberately avoid google/apiclient — google/auth (already vendored via
 * google/cloud-storage) mints the token and Guzzle (already present) POSTs the
 * raw RFC822 message. No heavy new dependency, no clash with the Cloud stack.
 */
class GmailApiTransport extends AbstractTransport
{
    private const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

    /**
     * @param FetchAuthTokenInterface $credentials Any google/auth credential that
     *        yields a gmail.send access token for support@errandguyph.com.
     * @param string $cacheKey Stable per-credential suffix for the token cache.
     */
    public function __construct(
        private readonly FetchAuthTokenInterface $credentials,
        private readonly string $cacheKey,
    ) {
        parent::__construct();
    }

    protected function doSend(SentMessage $message): void
    {
        // Gmail wants the full RFC822 message, base64url-encoded (no padding).
        $raw = rtrim(strtr(base64_encode($message->toString()), '+/', '-_'), '=');

        try {
            (new GuzzleClient())->post(self::SEND_URL, [
                'headers' => [
                    'Authorization' => 'Bearer ' . $this->accessToken(),
                    'Content-Type' => 'application/json',
                ],
                'json' => ['raw' => $raw],
                'timeout' => 15,
            ]);
        } catch (RequestException $e) {
            // Surface Gmail's JSON error body — Guzzle's default message truncates
            // it, and "400 Bad Request" alone is useless when debugging a rejected
            // From header, an expired refresh token, or a scope misconfiguration.
            $body = $e->hasResponse() ? (string) $e->getResponse()->getBody() : '';
            throw new TransportException('Gmail API send failed: ' . $e->getMessage() . ' ' . $body, 0, $e);
        } catch (\Throwable $e) {
            throw new TransportException('Gmail API send failed: ' . $e->getMessage(), 0, $e);
        }
    }

    /**
     * Access tokens live ~1h. Cache per credential so we mint one only when it is
     * close to expiry rather than on every send. 55-minute TTL leaves headroom.
     */
    private function accessToken(): string
    {
        return Cache::remember(
            'gmail_api_token:' . $this->cacheKey,
            now()->addMinutes(55),
            function (): string {
                $token = $this->credentials->fetchAuthToken();

                if (empty($token['access_token'])) {
                    throw new TransportException('Gmail API: failed to obtain an access token. Check the OAuth refresh token (or service-account credentials) and that the account can send mail.');
                }

                return $token['access_token'];
            }
        );
    }

    public function __toString(): string
    {
        return 'gmail+api://' . $this->cacheKey;
    }
}
