<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class LogApiRequests
{
    /** Skip logging for high-frequency endpoints that swamp the log channel. */
    private const SKIP_PATTERNS = [
        'runner/location',
        'chat/unread-count',
    ];

    /** Endpoints over this threshold are always logged so we can spot slow ones. */
    private const SLOW_THRESHOLD_MS = 500;

    public function handle(Request $request, Closure $next): Response
    {
        $start = microtime(true);

        $response = $next($request);

        $duration = round((microtime(true) - $start) * 1000, 2);
        $status = $response->getStatusCode();
        $path = $request->path();

        // Hot-path noise filter: skip the GPS push and unread-count
        // poller (each fires every few seconds per online user). We
        // were spending 2 file-locking writes per request on log lines
        // nobody reads.
        $isHotPath = false;
        foreach (self::SKIP_PATTERNS as $needle) {
            if (str_contains($path, $needle)) {
                $isHotPath = true;
                break;
            }
        }

        $isError = $status >= 400;
        $isSlow = $duration > self::SLOW_THRESHOLD_MS;

        // The per-request `API Response` info line fired a file-lock append
        // on ~every request — at scale that write is itself a bottleneck,
        // and in prod the file channel is not where anyone reads success
        // traffic. Drop the fast-success line on hot paths always, and in
        // production everywhere; keep it for local/staging debugging. Errors
        // and slow requests below still log in every environment (they are
        // the only latency/error signal until APM lands).
        if (! $isError && ! $isSlow && ($isHotPath || app()->isProduction())) {
            return $response;
        }

        $logData = [
            'method' => $request->method(),
            'url' => $request->fullUrl(),
            'status' => $status,
            'duration_ms' => $duration,
            'user_id' => $request->user()?->id,
        ];

        if ($isError) {
            $content = $response->getContent();
            $decoded = json_decode($content, true);
            $logData['response_body'] = $decoded ?? mb_substr($content, 0, 500);

            Log::warning('API Error Response', $logData);
        } elseif ($isSlow) {
            // Slow but successful — kept in every environment (prod included)
            // at `notice` so it survives the info suppression above and stays
            // findable as our only pre-APM latency signal.
            Log::notice('API Slow Response', $logData);
        } else {
            Log::info('API Response', $logData);
        }

        return $response;
    }
}
