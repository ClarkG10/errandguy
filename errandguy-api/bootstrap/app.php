<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // Registers POST /broadcasting/auth for private-channel authorization.
    // We register it explicitly (rather than via withRouting's `channels:`
    // arg, which defaults to the `web` session guard) so it runs under
    // Sanctum: the mobile app authorizes channels with the SAME bearer
    // token it uses for the API, and routes/channels.php reuses the booking
    // participant / user-id checks that already gate the REST endpoints.
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['middleware' => ['auth:sanctum']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Let $request->ip() + the rate limiters resolve the REAL client IP
        // behind the proxy chain, by trusting a configured proxy set from env.
        //
        // IMPORTANT — this is NOT "safe by default". When TRUSTED_PROXIES is
        // empty we do NOT call trustProxies(), so Laravel's default TrustProxies
        // applies: on a `*.on-forge.com` host it AUTO-TRUSTS ALL proxies, i.e.
        // ip() becomes the left-most X-Forwarded-For — the real client via
        // Cloudflare, but SPOOFABLE if the origin is reachable directly. On any
        // other host it trusts nothing (ip() = the edge, so per-IP throttling is
        // effectively global). Neither empty state is both correct and safe.
        //
        // To make it BOTH: set TRUSTED_PROXIES to the SPECIFIC Cloudflare (and
        // any LB) IP ranges — a non-empty value disables the on-forge auto-trust
        // and makes Symfony stop at the first untrusted hop (the real client),
        // which closes the spoof — AND firewall the origin so `*.on-forge.com`
        // is only reachable via Cloudflare. Never use '*' here (nginx appends
        // X-Forwarded-For, so trusting every hop is spoofable).
        $proxies = array_values(array_filter(array_map('trim', explode(',', (string) env('TRUSTED_PROXIES', '')))));
        if ($proxies !== []) {
            $middleware->trustProxies(
                at: in_array('*', $proxies, true) ? '*' : $proxies,
                headers: Request::HEADER_X_FORWARDED_FOR
                    | Request::HEADER_X_FORWARDED_HOST
                    | Request::HEADER_X_FORWARDED_PORT
                    | Request::HEADER_X_FORWARDED_PROTO,
            );
        }

        $middleware->api(prepend: [
            // FIRST: assign a correlation id before anything logs or renders, so
            // every log line + error envelope carries request_id.
            \App\Http\Middleware\AssignRequestId::class,
            \App\Http\Middleware\LogApiRequests::class,
            \App\Http\Middleware\SecurityHeaders::class,
            \App\Http\Middleware\LimitRequestSize::class,
            \App\Http\Middleware\SanitizeInput::class,
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
        ]);

        $middleware->alias([
            'role' => \App\Http\Middleware\RoleMiddleware::class,
            'active' => \App\Http\Middleware\EnsureUserActive::class,
            'idempotent' => \App\Http\Middleware\EnsureIdempotency::class,
            'etag' => \App\Http\Middleware\EtagConditional::class,
            'token.rotate' => \App\Http\Middleware\RotateAccessToken::class,
        ]);

        $middleware->throttleApi('api');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->reportable(function (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Unhandled exception', [
                'exception' => get_class($e),
                'message' => $e->getMessage(),
                'file' => $e->getFile() . ':' . $e->getLine(),
                'url' => request()?->fullUrl(),
                'method' => request()?->method(),
                'user_id' => request()?->user()?->id,
                // request_id is also attached via Log::withContext (AssignRequestId),
                // but keep it explicit here so the unhandled-exception line is
                // greppable by correlation id even if context is stripped.
                'request_id' => request()?->attributes->get('request_id'),
            ]);
        });

        // Standardized API error envelope for every JSON/api request. Kept in a
        // dedicated class so this bootstrap file stays scannable and the mapping
        // is unit-testable. Web (Filament) responses are untouched.
        \App\Exceptions\ApiExceptionRenderer::register($exceptions);

        // Ship unhandled exceptions to Sentry. This is a NO-OP until
        // SENTRY_LARAVEL_DSN is set (no client, no network) — safe to deploy
        // inert and switch on later. Registered after our reportable logger so
        // both fire; Sentry still honours the framework's dontReport list, and
        // config/sentry.php (send_default_pii=false + before_send scrubber)
        // governs what actually leaves the process.
        \Sentry\Laravel\Integration::handles($exceptions);
    })
    ->booting(function () {
        RateLimiter::for('api', function (Request $request) {
            // Authenticated mobile clients regularly burst 60+ requests/min
            // during a single tracking session (track polling + chat
            // unread + booking refresh + notification list + GPS pushes
            // on the runner side). The previous 60/min default was
            // tripping legitimate users into 429s mid-trip. 240/min
            // (4 rps avg) gives normal usage plenty of headroom while
            // still capping scripted abuse — and per-endpoint throttles
            // (auth, otp, location, sos, top-up) keep sensitive surfaces
            // tight regardless.
            return $request->user()
                ? Limit::perMinute(240)->by($request->user()->id)
                : Limit::perMinute(20)->by($request->ip());
        });

        RateLimiter::for('auth', function (Request $request) {
            $identifier = $request->input('phone')
                ?? $request->input('email')
                ?? $request->input('phone_or_email')
                ?? $request->ip();

            // Shared by register / forgot-password / reset-password / OTP-verify.
            // Kept keyed on the credential ALONE (a GLOBAL per-credential cap):
            // for forgot-password especially, this bounds reset-email bombing of
            // a victim to 5/15min TOTAL — keying it on identifier+IP would let an
            // attacker send 5×(number of IPs) reset emails. Login does NOT use
            // this limiter (see the 'login' limiter below).
            return [
                Limit::perMinutes(15, 5)->by('auth:' . $identifier),
                Limit::perMinutes(15, 30)->by('auth-ip:' . $request->ip()),
            ];
        });

        // Login gets its OWN limiter, keyed on credential + SOURCE IP. Keying on
        // the credential alone (as the shared 'auth' limiter does) let anyone who
        // knew a victim's email/phone lock that account out of every device with
        // 5 junk attempts — a pre-auth DoS (AUTHX-3). Per-IP scoping means an
        // attacker only locks their own IP against the account, never the
        // legitimate user on their own device, while still capping brute-force
        // from one source at 5/15min. Truly per-client once TRUSTED_PROXIES
        // resolves the real client IP (see withMiddleware); until then ip() is
        // the edge and it degrades to per-credential — no worse than before.
        RateLimiter::for('login', function (Request $request) {
            $identifier = $request->input('phone')
                ?? $request->input('email')
                ?? $request->input('phone_or_email')
                ?? $request->ip();

            return [
                Limit::perMinutes(15, 5)->by('login:' . $identifier . '|' . $request->ip()),
                Limit::perMinutes(15, 30)->by('login-ip:' . $request->ip()),
            ];
        });

        // Recovery / verify COMPLETION paths (reset-password, verify-otp). Keyed
        // on credential + SOURCE IP like 'login': an attacker who spams a
        // victim's credential only fills their OWN IP bucket, so the legitimate
        // user can always complete recovery from their own device. The shared
        // 'auth' limiter (credential-only) locked these paths for the whole
        // window once an attacker sent 5 junk requests for the victim's
        // credential (AUTHX-3 class). forgot-password intentionally STAYS on
        // 'auth' so outbound reset-email bombing remains globally capped per
        // credential (keying it on +IP would let an attacker send 5×#IPs emails).
        RateLimiter::for('auth-verify', function (Request $request) {
            $identifier = $request->input('phone')
                ?? $request->input('email')
                ?? $request->input('phone_or_email')
                ?? $request->ip();

            return [
                Limit::perMinutes(15, 5)->by('authverify:' . $identifier . '|' . $request->ip()),
                Limit::perMinutes(15, 30)->by('authverify-ip:' . $request->ip()),
            ];
        });

        RateLimiter::for('otp', function (Request $request) {
            $key = $request->input('phone', $request->input('email', $request->ip()));

            // Two buckets: a per-RECIPIENT 3/hr cap AND a per-IP aggregate cap.
            // Without the second, one source could rotate through unlimited
            // distinct recipient addresses (each its own fresh 3/hr bucket) to
            // fan out real verification emails — only the global 'api' 20/min
            // anon cap applied (~1200 emails/hr to attacker-chosen inboxes). The
            // per-IP cap mirrors the secondary limit the 'auth'/'login' limiters
            // already carry. Tuned to accommodate NAT/shared-IP legitimate use
            // while cutting the abuse ceiling ~40×.
            return [
                Limit::perHour(3)->by('otp:' . $key),
                Limit::perHour(30)->by('otp-ip:' . $request->ip()),
            ];
        });
    })
    ->create();
