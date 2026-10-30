<?php

namespace App\Http\Controllers;

use App\Jobs\WorkerHeartbeatJob;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Deep health probe for an outside uptime monitor — point it at GET /health
 * and alert on anything but 200. Laravel's default '/up' only confirms the
 * framework boots; this checks what the marketplace actually runs on:
 *
 *   - database and cache (Redis in production);
 *   - scheduler: the every-minute heartbeat (routes/console.php) — backups,
 *     reapers, money reconciliation and safety monitors all ride it;
 *   - worker: the queue worker's heartbeat (WorkerHeartbeatJob, queued by the
 *     scheduler every minute) — matching, push, auto-cancel and SOS fan-out;
 *   - realtime: the Reverb server answering its /up (chat, live tracking,
 *     in-app notifications). Skipped when broadcasting isn't 'reverb'.
 *
 * 200 when every check passes, 503 when any fails. A heartbeat counts as
 * failing once it is more than 3 minutes old, or missing (a cache flush
 * clears it; the next beat restores it within a minute).
 */
class HealthController extends Controller
{
    /** Heartbeats fire every minute; 180s = 3 missed beats. */
    private const HEARTBEAT_MAX_AGE = 180;

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
            'scheduler' => $this->heartbeat('scheduler:heartbeat'),
            'worker' => $this->heartbeat(WorkerHeartbeatJob::CACHE_KEY),
            'realtime' => $this->realtime(),
        ];

        $healthy = collect($checks)->every(fn (string $state) => in_array($state, ['up', 'ok', 'disabled'], true));

        return response()->json([
            'status' => $healthy ? 'ok' : 'degraded',
            'checks' => $checks,
            // Kept at the top level for monitors already reading it.
            'scheduler' => $checks['scheduler'],
        ], $healthy ? 200 : 503);
    }

    /**
     * 'ok'      — heartbeat within the freshness window,
     * 'stale'   — heartbeat present but older than the window,
     * 'unknown' — no heartbeat / cache unavailable (can't tell).
     */
    private function heartbeat(string $key): string
    {
        try {
            $ts = Cache::get($key);

            if ($ts === null) {
                return 'unknown';
            }

            return (now()->timestamp - (int) $ts) > self::HEARTBEAT_MAX_AGE ? 'stale' : 'ok';
        } catch (\Throwable $e) {
            return 'unknown';
        }
    }

    /**
     * Reverb answers GET /up on the host/port the app publishes to (loopback
     * in production). Short timeouts, and the answer is cached for 15 seconds,
     * so a wedged Reverb can't pin a PHP worker per /health hit.
     */
    private function realtime(): string
    {
        if (config('broadcasting.default') !== 'reverb') {
            return 'disabled';
        }

        $options = (array) config('broadcasting.connections.reverb.options', []);
        $url = sprintf(
            '%s://%s:%s/up',
            $options['scheme'] ?? 'https',
            $options['host'] ?? '127.0.0.1',
            $options['port'] ?? 443,
        );

        $probe = function () use ($url): string {
            try {
                return Http::connectTimeout(1)->timeout(2)->get($url)->successful() ? 'up' : 'down';
            } catch (\Throwable $e) {
                Log::warning('[health] realtime check failed', ['error' => $e->getMessage()]);

                return 'down';
            }
        };

        try {
            return Cache::remember('health:realtime', 15, $probe);
        } catch (\Throwable $e) {
            return $probe();
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
