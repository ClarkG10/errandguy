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

        $healthy = ! in_array('down', $checks, true);

        return response()->json([
            'status' => $healthy ? 'ok' : 'degraded',
            'checks' => $checks,
        ], $healthy ? 200 : 503);
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
