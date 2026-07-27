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
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->api(prepend: [
            \App\Http\Middleware\LogApiRequests::class,
            \App\Http\Middleware\SecurityHeaders::class,
            \App\Http\Middleware\LimitRequestSize::class,
            \App\Http\Middleware\SanitizeInput::class,
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
        ]);

        $middleware->alias([
            'role' => \App\Http\Middleware\RoleMiddleware::class,
            'active' => \App\Http\Middleware\EnsureUserActive::class,
            'admin' => \App\Http\Middleware\EnsureAdminUser::class,
            'idempotent' => \App\Http\Middleware\EnsureIdempotency::class,
            'etag' => \App\Http\Middleware\EtagConditional::class,
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
            ]);
        });
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

            // Hard cap of 5 attempts per 15 minutes per credential
            // (login, register, password reset, social login, OTP
            // verify all share this bucket). The parallel IP-bucket
            // limit catches credential-spraying from a single source
            // even when each identifier stays under its own cap.
            return [
                Limit::perMinutes(15, 5)->by('auth:' . $identifier),
                Limit::perMinutes(15, 30)->by('auth-ip:' . $request->ip()),
            ];
        });

        RateLimiter::for('otp', function (Request $request) {
            $key = $request->input('phone', $request->input('email', $request->ip()));
            return Limit::perHour(3)->by($key);
        });
    })
    ->create();
