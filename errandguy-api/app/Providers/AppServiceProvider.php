<?php

namespace App\Providers;

use App\Mail\Transport\GmailApiTransport;
use App\Models\AdminUser;
use App\Support\JobFailureReporter;
use App\Support\RequestMetrics;
use Google\Auth\Credentials\ServiceAccountCredentials;
use Google\Auth\Credentials\UserRefreshCredentials;
use Illuminate\Http\Request;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One counter instance per request (standard, non-Octane lifecycle).
        $this->app->singleton(RequestMetrics::class);
    }

    public function boot(): void
    {
        // Count DB queries per request for the slow/error log + N+1 flagging in
        // LogApiRequests. Just an int increment per query; the middleware resets
        // it at the start of each request. Gate exists so it can be disabled.
        if (config('app.query_metrics', true)) {
            DB::listen(function (): void {
                if ($this->app->resolved(RequestMetrics::class)) {
                    $this->app->make(RequestMetrics::class)->queries++;
                }
            });
        }

        // NOTE: no Event::listen() calls here on purpose. Laravel 13
        // auto-discovers every listener in app/Listeners by the event type-hint
        // on its public methods (including non-`handle` names like
        // SendSafetyAlertNotification::handleDurationAlert). Registering the
        // same listeners explicitly here registered them a SECOND time, so every
        // booking-notification and safety-alert listener fired TWICE (duplicate
        // in-app rows + double pushes). Discovery is the single source of truth.

        // Clamped page size for list endpoints. A client could otherwise pass
        // per_page=1000000 and force an unbounded query / huge payload. Use
        // $request->perPage($default) instead of ->integer('per_page', ...).
        Request::macro('perPage', function (int $default = 20, int $max = 100): int {
            /** @var Request $this */
            return max(1, min($this->integer('per_page', $default), $max));
        });

        // Admin-panel users authorize via Filament resource role-gates
        // (canViewAny / per-action ->visible()), NOT the app's model policies —
        // which type-hint App\Models\User and would TypeError when Filament
        // delegates a per-record check (e.g. BookingPolicy::view) with an
        // AdminUser. Short-circuit the Gate for AdminUser so those policies are
        // never invoked; regular User authorization (mobile API) is untouched
        // (returns null → normal policy evaluation).
        Gate::before(fn ($user, string $ability) => $user instanceof AdminUser ? true : null);

        // Make a permanently-failed queue job visible to a human. Fires once per
        // job after retries are exhausted; logs CRITICAL + raises an admin
        // dashboard alert. Without it, a failed settlement / SOS-fan-out / push
        // job vanishes into failed_jobs (pruned after 7 days) with no signal.
        Queue::failing(function (JobFailed $event): void {
            JobFailureReporter::report(
                $event->job->resolveName(),
                $event->exception->getMessage(),
                $event->connectionName,
            );
        });

        // Custom "gmail" mail transport: sends via the Gmail REST API as a fixed
        // Workspace mailbox (support@errandguyph.com). Auth is an OAuth2 refresh
        // token (service-account delegation is a fallback — see buildGmailCredentials).
        // Laravel has no built-in Gmail API driver, so we register one here — see
        // App\Mail\Transport\GmailApiTransport. The closure receives the
        // config/mail.php `mailers.gmail` array.
        Mail::extend('gmail', function (array $config): GmailApiTransport {
            [$credentials, $cacheKey] = $this->buildGmailCredentials($config);

            return new GmailApiTransport($credentials, $cacheKey);
        });
    }

    /**
     * Build the google/auth credential the Gmail transport will use, plus a stable
     * per-credential cache-key suffix. Two modes, OAuth first:
     *   1. OAuth2 user-refresh token — an OAuth client is a different credential
     *      type than a service-account key, so it is NOT blocked by the org policy
     *      that disables SA-key creation. Sends as the account that consented
     *      (support@errandguyph.com); no impersonation.
     *   2. Service account + domain-wide delegation — the `impersonate` mailbox is
     *      the DWD subject. Alternative for if a key ever becomes available.
     *
     * @param array<string,mixed> $config
     * @return array{0: \Google\Auth\FetchAuthTokenInterface, 1: string}
     */
    private function buildGmailCredentials(array $config): array
    {
        $scope = 'https://www.googleapis.com/auth/gmail.send';

        // 1. OAuth2 user-refresh-token mode.
        if (!empty($config['oauth_refresh_token'])) {
            if (empty($config['oauth_client_id']) || empty($config['oauth_client_secret'])) {
                throw new \RuntimeException('Gmail OAuth: set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET alongside GMAIL_OAUTH_REFRESH_TOKEN.');
            }

            $credentials = new UserRefreshCredentials($scope, [
                'client_id' => $config['oauth_client_id'],
                'client_secret' => $config['oauth_client_secret'],
                'refresh_token' => $config['oauth_refresh_token'],
            ]);

            // Key by client_id + refresh_token so rotating either busts the cache.
            $cacheKey = 'oauth:' . sha1($config['oauth_client_id'] . '|' . $config['oauth_refresh_token']);

            return [$credentials, $cacheKey];
        }

        // 2. Service-account (domain-wide delegation) mode.
        $key = $this->resolveGmailCredentials($config);
        $impersonate = $config['impersonate'] ?? (string) config('mail.from.address');
        $credentials = new ServiceAccountCredentials($scope, $key, $impersonate);

        return [$credentials, 'sa:' . sha1((string) $impersonate)];
    }

    /**
     * Resolve the Gmail service-account key from config. Precedence:
     *   1. Discrete fields  (GMAIL_CLIENT_EMAIL / GMAIL_PRIVATE_KEY / …) — primary
     *   2. GMAIL_SA_BASE64  (base64 of the whole JSON key)
     *   3. GMAIL_SA_PATH    (path to the JSON key file)
     * Returns the decoded array or a file path; ServiceAccountCredentials accepts
     * either. Throws with a clear message if none is set so a misconfiguration
     * fails loudly at first send rather than silently no-op'ing.
     *
     * @param array<string,mixed> $config
     * @return string|array<string,mixed>
     */
    private function resolveGmailCredentials(array $config): string|array
    {
        // 1. Discrete service-account fields.
        if (!empty($config['client_email']) && !empty($config['private_key'])) {
            return [
                'type' => 'service_account',
                'project_id' => $config['project_id'] ?? null,
                'private_key_id' => $config['private_key_id'] ?? null,
                // In .env the PEM is stored either with escaped "\n" on one line
                // or as a genuine multi-line quoted value. Normalise the escaped
                // form to real newlines so OpenSSL can parse the key; a value that
                // already has real newlines is unaffected (no literal "\n" to sub).
                'private_key' => str_replace('\\n', "\n", (string) $config['private_key']),
                'client_email' => $config['client_email'],
                'client_id' => $config['client_id'] ?? null,
                'client_x509_cert_url' => $config['client_cert_url'] ?? null,
                'token_uri' => 'https://oauth2.googleapis.com/token',
            ];
        }

        // 2. Base64 blob.
        if (!empty($config['credentials_base64'])) {
            $json = base64_decode((string) $config['credentials_base64'], true);
            $decoded = $json === false ? null : json_decode($json, true);

            if (!is_array($decoded)) {
                throw new \RuntimeException('GMAIL_SA_BASE64 is not valid base64-encoded service-account JSON.');
            }

            return $decoded;
        }

        // 3. File path.
        if (!empty($config['credentials'])) {
            $path = (string) $config['credentials'];

            if (!is_file($path)) {
                throw new \RuntimeException("Gmail mailer: service-account key not found at GMAIL_SA_PATH ({$path}).");
            }

            return $path;
        }

        throw new \RuntimeException('Gmail mailer is not configured: set the OAuth vars (GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN), or a service-account key (GMAIL_CLIENT_EMAIL + GMAIL_PRIVATE_KEY, GMAIL_SA_BASE64, or GMAIL_SA_PATH).');
    }
}
