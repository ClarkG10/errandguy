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
        // Real client IP behind Cloudflare / a load balancer, from the
        // TRUSTED_PROXIES list (config/trustedproxy.php) read at request time.
        // See App\Http\Middleware\TrustProxies.
        $middleware->replace(
            \Illuminate\Http\Middleware\TrustProxies::class,
            \App\Http\Middleware\TrustProxies::class,
        );

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
        // The credential a throttle is keyed on, spelled one way: a phone as
        // +639XXXXXXXXX and an email in lower case, so "0917…" / "+63917…" or
        // "Ana@" / "ana@" can't each get a fresh bucket. Falls back to the IP.
        $credential = function (Request $request): string {
            $phone = $request->input('phone');
            if (is_string($phone) && $phone !== '') {
                return \App\Support\PhilippinePhone::canonical($phone) ?? $phone;
            }

            $other = $request->input('email') ?? $request->input('phone_or_email');

            return is_string($other) && $other !== '' ? mb_strtolower(trim($other)) : (string) $request->ip();
        };

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

        RateLimiter::for('auth', function (Request $request) use ($credential) {
            $identifier = $credential($request);

            // Registration. Keyed on the credential ALONE (a GLOBAL
            // per-credential cap) plus a per-IP aggregate. Login, the
            // verify/reset completion paths and the code senders each have
            // their own limiter below.
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
        // from one source at 5/15min. Per-client only while TRUSTED_PROXIES
        // names the edge in front of the app (App\Http\Middleware\TrustProxies);
        // without it ip() is the edge and this degrades to per-credential.
        RateLimiter::for('login', function (Request $request) use ($credential) {
            $identifier = $credential($request);

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
        RateLimiter::for('auth-verify', function (Request $request) use ($credential) {
            $identifier = $credential($request);

            return [
                Limit::perMinutes(15, 5)->by('authverify:' . $identifier . '|' . $request->ip()),
                Limit::perMinutes(15, 30)->by('authverify-ip:' . $request->ip()),
            ];
        });

        RateLimiter::for('otp', function (Request $request) use ($credential) {
            $key = $credential($request);

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

        // Password-reset codes: the same caps as sign-in codes (3 an hour per
        // address, 30 an hour per IP) in their own buckets. Applied whether or
        // not the address has an account, so a 429 reveals nothing either.
        RateLimiter::for('otp-password-reset', function (Request $request) use ($credential) {
            return [
                Limit::perHour(3)->by('otp-reset:'.$credential($request)),
                Limit::perHour(30)->by('otp-reset-ip:'.$request->ip()),
            ];
        });

        // Signed-in "confirm my email": 3 codes an hour, and 10 guesses per
        // 15 minutes on top of the 5-per-code limit.
        RateLimiter::for('otp-email-verification', fn (Request $request) => Limit::perHour(3)
            ->by('otp-verify-email:'.($request->user()?->id ?? $request->ip())));
        RateLimiter::for('email-verify', fn (Request $request) => Limit::perMinutes(15, 10)
            ->by('email-verify:'.($request->user()?->id ?? $request->ip())));

        // Changing the password checks the current one: cap the guesses.
        RateLimiter::for('password-change', fn (Request $request) => Limit::perMinutes(15, 5)
            ->by('password-change:'.($request->user()?->id ?? $request->ip())));

        // Crash reports, signed in or not: per account when signed in,
        // otherwise per IP, so a crash-looping or hostile client can't flood
        // the log.
        RateLimiter::for('client-errors', function (Request $request) {
            $user = auth('sanctum')->user();

            return $user
                ? Limit::perMinute(30)->by('client-errors:u:'.$user->getAuthIdentifier())
                : Limit::perMinute(10)->by('client-errors:ip:'.$request->ip());
        });
    })
    ->create();
