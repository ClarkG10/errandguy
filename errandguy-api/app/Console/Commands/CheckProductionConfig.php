<?php

namespace App\Console\Commands;

use App\Support\TrustedProxyList;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Surface degraded / unsafe PRODUCTION configuration that lives off-repo (in the
 * Forge .env) and otherwise fails silently. The audit's recurring theme was
 * "operational blindness" — APP_DEBUG left on, realtime broadcasting disabled,
 * a file cache, or a sync queue all *look* fine until something breaks. This
 * makes each one a loud log line (CRITICAL/WARNING) so log review — and, once
 * error-tracking is wired, alerting — catches it.
 *
 * Log-only by design: it never changes behaviour or fails a boot, so scheduling
 * it can't take the app down. Scheduled daily (routes/console.php).
 */
class CheckProductionConfig extends Command
{
    protected $signature = 'errandguy:check-prod-config';

    protected $description = 'Warn if production is running with unsafe/degraded config (APP_DEBUG, broadcast, cache, queue, proxies, mail).';

    public function handle(): int
    {
        $issues = self::detect();

        foreach ($issues as $issue) {
            // Only emit to the log in production (where the schedule runs and the
            // finding is real); a manual run in any env still prints for the dev.
            if (app()->environment('production')) {
                Log::log($issue['level'], '[prod-config] '.$issue['message']);
            }
            $this->line('<comment>'.strtoupper($issue['level']).'</comment>: '.$issue['message']);
        }

        if ($issues === []) {
            $this->info('Production config OK.');
        }

        // Non-zero exit lets a deploy / CI step optionally gate on this.
        return $issues === [] ? self::SUCCESS : self::FAILURE;
    }

    /**
     * Pure detection over the current config — returns a list of
     * ['level' => 'critical'|'warning', 'message' => string]. Kept static +
     * side-effect-free so it is unit-testable without faking the environment.
     *
     * @return array<int, array{level: string, message: string}>
     */
    public static function detect(): array
    {
        $issues = [];

        if (config('app.debug')) {
            $issues[] = ['level' => 'critical', 'message' => 'APP_DEBUG=true — stack traces, file paths and internals leak on every error and via the admin panel. Set APP_DEBUG=false.'];
        }

        $broadcast = config('broadcasting.default');
        if (in_array($broadcast, [null, 'null', 'log'], true)) {
            $issues[] = ['level' => 'warning', 'message' => "BROADCAST_CONNECTION='".($broadcast ?? 'null')."' — realtime (chat, notifications, live tracking) will not publish. Set it to 'reverb'."];
        }

        if (config('cache.default') === 'file') {
            $issues[] = ['level' => 'warning', 'message' => "CACHE_STORE='file' — rate-limit / ETag / idempotency state is best-effort and does not hold under concurrency. Use 'redis'."];
        }

        // Read exactly as App\Http\Middleware\TrustProxies reads it (config,
        // not env(), so it survives config:cache).
        if (TrustedProxyList::configured() === []) {
            $issues[] = ['level' => 'critical', 'message' => 'TRUSTED_PROXIES is empty — forwarded headers are ignored, so behind Cloudflare every client shares the edge\'s IP and the per-IP limits on sign-in, codes and sign-up are shared by everyone (one busy edge locks real users out). Set TRUSTED_PROXIES=cloudflare (or the specific proxy ranges) and firewall the origin to Cloudflare only.'];
        }

        foreach (self::mailIssues() as $issue) {
            $issues[] = $issue;
        }

        $queue = config('queue.default');
        if ($queue === 'sync') {
            $issues[] = ['level' => 'critical', 'message' => "QUEUE_CONNECTION='sync' — jobs (matching, auto-cancel, push, safety monitors) run inline in the request/webhook thread. Set it to 'redis' with a running worker."];
        } elseif ($queue === 'database') {
            $issues[] = ['level' => 'warning', 'message' => "QUEUE_CONNECTION='database' — workable, but 'redis' is recommended for the throughput the matching/push jobs need."];
        }

        // Error monitoring: the Sentry wiring is inert until a DSN is pasted, so
        // an empty DSN in prod means every crash is invisible — exactly the
        // "operational blindness" this command exists to break. (audit C1)
        if (blank(config('sentry.dsn'))) {
            $issues[] = ['level' => 'warning', 'message' => 'SENTRY_LARAVEL_DSN is empty — error monitoring is inert, so production crashes/500s are reported nowhere and no alert fires. Paste the project DSN to activate it (no code change needed).'];
        }

        // SOS: with no SMS key nothing is texted (trusted contacts, staff), and
        // with no ops_alert_emails no staff email goes out — an SOS then reaches
        // only an admin who happens to have the panel open.
        if (blank(config('services.semaphore.api_key'))) {
            $issues[] = ['level' => 'warning', 'message' => 'SEMAPHORE_API_KEY is empty — an SOS texts nobody: not the person’s trusted contacts, not the ops_alert_phone numbers. Set the Semaphore API key to switch texts on.'];
        }
        if (\App\Support\OpsAlertRecipients::emails() === []) {
            $issues[] = ['level' => 'warning', 'message' => 'No ops alert email is set — an SOS emails no one and the ops digest is off. Fill in the ops_alert_emails setting in the admin panel (System → System configs).'];
        }

        // Realtime is CONFIGURED but not CREDENTIALED: broadcasting.default is
        // 'reverb' yet the app key/secret/id are unset, so every broadcast
        // publish 500s server-side and no client can authenticate — chat, live
        // tracking and in-app notifications are silently dead.
        if ($broadcast === 'reverb') {
            $reverbKey = config('broadcasting.connections.reverb.key');
            $reverbSecret = config('broadcasting.connections.reverb.secret');
            $reverbAppId = config('broadcasting.connections.reverb.app_id');
            if (blank($reverbKey) || blank($reverbSecret) || blank($reverbAppId)) {
                $issues[] = ['level' => 'critical', 'message' => "BROADCAST_CONNECTION='reverb' but REVERB_APP_KEY/SECRET/ID are not all set — realtime (chat, live tracking, notifications) will fail to publish and no client can connect. Set the three Reverb credentials."];
            }
        }

        // Canonical URL: signed URLs, deep links and absolute asset/media URLs
        // are built from APP_URL. A localhost / non-HTTPS value in prod yields
        // broken links and invalid signatures.
        $appUrl = (string) config('app.url');
        if ($appUrl === '' || str_contains($appUrl, 'localhost') || str_contains($appUrl, '127.0.0.1') || str_starts_with($appUrl, 'http://')) {
            $issues[] = ['level' => 'warning', 'message' => "APP_URL='".($appUrl ?: '(empty)')."' — signed URLs, deep links and absolute media URLs are built from this; a localhost/non-HTTPS value breaks them in production. Set it to the public https:// origin."];
        }

        return $issues;
    }

    /**
     * Mail carries password-reset and sign-in codes, email confirmation and
     * the SOS / ops alerts to staff. A mailer that isn't set up "sends"
     * nothing and nobody is told — critical.
     *
     * @return array<int, array{level: string, message: string}>
     */
    private static function mailIssues(): array
    {
        $mailer = (string) config('mail.default');

        if (in_array($mailer, ['', 'log', 'array'], true)) {
            return [['level' => 'critical', 'message' => "MAIL_MAILER='".($mailer ?: '(empty)')."' — no email leaves the server: password-reset and sign-in codes, email confirmation and SOS staff alerts are written to the log instead. Set MAIL_MAILER=gmail and the GMAIL_OAUTH_* values (docs/EMAIL_GMAIL_API_SETUP.md)."]];
        }

        $issues = [];
        $missing = match ($mailer) {
            'gmail' => self::gmailCredentialsMissing(),
            'smtp' => blank(config('mail.mailers.smtp.host')) || blank(config('mail.mailers.smtp.username')) ? 'MAIL_HOST / MAIL_USERNAME / MAIL_PASSWORD' : null,
            'resend' => blank(config('services.resend.key')) ? 'RESEND_API_KEY' : null,
            default => null,
        };
        if ($missing !== null) {
            $issues[] = ['level' => 'critical', 'message' => "MAIL_MAILER='{$mailer}' but {$missing} is not set — every email (codes, SOS staff alerts) will fail to send."];
        }

        $from = (string) config('mail.from.address');
        if ($from === '' || str_ends_with($from, '@example.com')) {
            $issues[] = ['level' => 'warning', 'message' => "MAIL_FROM_ADDRESS='".($from ?: '(empty)')."' — set it to the mailbox mail is sent from (support@errandguyph.com)."];
        }

        return $issues;
    }

    /** What the gmail transport lacks, or null when one credential set is complete. */
    private static function gmailCredentialsMissing(): ?string
    {
        $gmail = (array) config('mail.mailers.gmail', []);

        $oauth = filled($gmail['oauth_client_id'] ?? null)
            && filled($gmail['oauth_client_secret'] ?? null)
            && filled($gmail['oauth_refresh_token'] ?? null);
        $serviceAccount = filled($gmail['credentials_base64'] ?? null)
            || filled($gmail['credentials'] ?? null)
            || (filled($gmail['client_email'] ?? null) && filled($gmail['private_key'] ?? null));

        return $oauth || $serviceAccount ? null : 'GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN';
    }
}
