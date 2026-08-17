<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Deep health probe for uptime monitors / load balancers. Laravel's default
 * '/up' only confirms the framework boots — it returns 200 while the database,
 * Redis, or the queue store are down. This verifies the critical backing
 * services (DB + cache/queue store, which is Redis in prod) so a monitor goes
 * RED during a real dependency outage. 200 when all checks pass, 503 otherwise.
 */
class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $checks = [
            'database' => $this->probe(fn () => DB::select('select 1')),
            'cache' => $this->probe(function () {
                $key = 'health:'.Str::random(12);
                Cache::put($key, '1', 5);
                $ok = Cache::get($key) === '1';
                Cache::forget($key);
                if (! $ok) {
                    throw new \RuntimeException('cache round-trip failed');
                }
            }),
        ];

        // Only DB + cache decide the 200/503 (the LB pulls the box on these).
        $healthy = ! in_array('down', $checks, true);

        // Scheduler liveness is INFORMATIONAL, never part of the 503 decision: a
        // stopped cron is worth alerting on, but must not pull a serving box out
        // of the load balancer. A monitor watches this field (ok | stale |
        // unknown); see the scheduler-heartbeat task in routes/console.php.
        return response()->json([
            'status' => $healthy ? 'ok' : 'degraded',
            'checks' => $checks,
            'scheduler' => $this->schedulerStatus(),
        ], $healthy ? 200 : 503);
    }

    /**
     * 'ok'      — heartbeat within the freshness window,
     * 'stale'   — heartbeat present but older than the window (cron stopped),
     * 'unknown' — no heartbeat / cache unavailable (can't tell).
     */
    private function schedulerStatus(): string
    {
        try {
            $ts = Cache::get('scheduler:heartbeat');

            if ($ts === null) {
                return 'unknown';
            }

            // Heartbeat fires every minute; 180s = 3 missed beats.
            return (now()->timestamp - (int) $ts) > 180 ? 'stale' : 'ok';
        } catch (\Throwable $e) {
            return 'unknown';
        }
    }

    private function probe(callable $check): string
    {
        try {
            $check();

            return 'up';
        } catch (\Throwable $e) {
            Log::warning('[health] dependency check failed', ['error' => $e->getMessage()]);

            return 'down';
        }
    }
}
