<?php

namespace App\Providers;

use App\Support\RequestMetrics;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
    }
}
